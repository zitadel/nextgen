import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { Git } from "./git";
import type { Check } from "./operation";
import { CurrentCommit } from "./operations/current-commit";
import type { Author, PathFilter } from "./types";

/**
 * A temporary staging area (`GIT_INDEX_FILE`), so a commit or a diff is put
 * together without touching the developer's own, which may hold staged work
 * of theirs, another package's included.
 *
 * Made with {@link temporary}, which removes it however the work ends. A
 * commit starts it at the last commit ({@link startFromHead}); a diff starts
 * it from a copy of the developer's ({@link startFromDevelopers}). Its methods
 * are the steps an operation takes, so the operation reads as a list of them.
 */
export class StagingArea {
  /** git, pointed at this staging area. */
  readonly git: Git;
  private readonly index: string;

  /** The staging area kept in `index`. */
  private constructor(git: Git, index: string) {
    this.index = index;
    this.git = git.with({ GIT_INDEX_FILE: index });
  }

  /**
   * Runs `work` with a new staging area for `git`'s directory, removed afterwards.
   *
   * A failure to remove it is dropped: by then the work is done, and a commit
   * that landed must not be reported as failed because a temporary file was
   * briefly held open (as Windows Defender does).
   */
  static async temporary<T>(git: Git, work: (staging: StagingArea) => Promise<T>): Promise<T> {
    const scratch = await mkdtemp(join(tmpdir(), "git-staging-"));
    try {
      return await work(new StagingArea(git, join(scratch, "index")));
    } finally {
      await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Starts at the last commit, keeping what the developer's staging area knows about each file; empty before one.
   *
   * It starts as a copy of `developers`' staging area and is then reset to
   * the last commit with `read-tree -m`, which keeps each entry's flags and
   * file timestamps where the content is unchanged. The flags matter: a file
   * the developer marked `skip-worktree` or `assume-unchanged` (a local
   * config with real credentials, or the files outside a sparse checkout)
   * keeps its mark, so its local state is never staged. The timestamps spare
   * git from hashing every file again. Another package's staged work is
   * dropped by the reset, so the commit carries the rest of the repository as
   * last committed.
   */
  async startFromHead(developers: Git): Promise<void> {
    await this.startFromDevelopers(developers);
    const head = await new CurrentCommit().run(this.git);
    if (head === null) {
      await this.git.run(["read-tree", "--empty"]);
    } else {
      await this.git.run(["read-tree", "-m", head]);
    }
  }

  /**
   * Starts as a copy of the developer's staging area, keeping its timestamps.
   *
   * A copy rather than an empty one, so a tracked file that `.gitignore` now
   * matches still diffs. The timestamps matter: git trusts an entry only for a
   * file older than the index, so a copy stamped now hid an edit made in the
   * same second as the developer's last `git add`. A fresh repository has no
   * index yet, and the copy then starts empty.
   */
  async startFromDevelopers(developers: Git): Promise<void> {
    const index = resolve(
      developers.dir,
      (await developers.run(["rev-parse", "--git-path", "index"])).text(),
    );
    if (existsSync(index)) {
      await copyFile(index, this.index);
      const { atime, mtime } = await stat(index);
      await utimes(this.index, atime, mtime);
    }
  }

  /**
   * Stages everything under the directory but what `except` matches, as `git add --all -- .` would.
   *
   * The changed and untracked files are listed first to find the ones
   * `except` matches, and those are then left out of a single
   * `git add --all -- .` with `:(exclude)`. An excluded file is never read, so
   * its content is never written to the object store, where it would sit as
   * a loose object until git cleans it up. Staging stays `git add --all -- .`
   * in every other way: a file that vanishes meanwhile, a tracked file in an
   * ignored directory and a sparse checkout all behave as they do for the
   * developer, and matching stays linear however many files there are. A
   * file that is already tracked and excluded keeps what the last commit has.
   *
   * The pathspecs go through a file beside the staging area, read and written
   * byte for byte: a name that is not valid UTF-8, which Linux allows, would
   * otherwise come back changed and match nothing. `except` sees each name as
   * UTF-8.
   *
   * Exit 1 is accepted: git gives it when everything `.` matches is a file the
   * developer marked `skip-worktree`, having staged nothing, which is the
   * right result. A real failure, such as a file that cannot be read, exits
   * 128. Whether anything was staged is for the caller to check.
   */
  async addAll(except: PathFilter): Promise<void> {
    const listed = await this.git.run(
      ["ls-files", "-z", "--modified", "--deleted", "--others", "--exclude-standard", "--", "."],
      [],
      "latin1",
    );
    const excluded = listed
      .paths()
      .filter((path) => except(Buffer.from(path, "latin1").toString("utf8")))
      .map((path) => `:(exclude,literal)${path}`);
    const list = join(dirname(this.index), "paths");
    await writeFile(list, Buffer.from([".", ...excluded].join("\0"), "latin1"));
    await this.git.run(
      ["add", "--all", `--pathspec-from-file=${list}`, "--pathspec-file-nul"],
      [1],
    );
  }

  /**
   * Marks the untracked files among `paths` "intent to add", so a diff shows them as added.
   *
   * Intent to add records the file without its content, so nothing is written
   * to the object store. Only paths that exist are passed: `git add` refuses
   * the whole call when one matches nothing. An ignored path makes it mark the
   * rest and exit 1, which is accepted. Each path is taken literally
   * ({@link Git.literal}), so `app/[id].tsx` marks only itself.
   */
  async markAsAdded(paths: readonly string[]): Promise<void> {
    const present = paths.filter((path) => this.git.exists(path)).map(Git.literal);
    if (present.length > 0) {
      await this.git.run(["add", "--intent-to-add", "--", ...present], [1]);
    }
  }

  /** The first problem any of `checks` finds with what is staged, or null. */
  async problem(checks: readonly Check[]): Promise<string | null> {
    for (const check of checks) {
      const problem = await check.problem(this.git);
      if (problem !== null) {
        return problem;
      }
    }
    return null;
  }

  /**
   * Commits what is staged with `message`, naming `author` as author and committer when given.
   *
   * Without `author`, git names whoever it would. An author is set through
   * the environment rather than `-c user.*`: an inherited empty
   * `GIT_AUTHOR_NAME=`, as some CI runners leave it, outranks `-c`, and git
   * would refuse the commit with "empty ident name".
   *
   * Signing is turned off, so a configured key cannot block on a passphrase
   * prompt. `--no-verify` skips the pre-commit and commit-msg hooks, which a
   * scaffolded app's linter would otherwise fail; post-commit hooks still run,
   * as they always did.
   */
  async commit(message: string, author: Author | null): Promise<void> {
    const commit = [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      `--message=${message}`,
    ];
    if (author === null) {
      await this.git.run(commit);
    } else {
      const named = this.git.with({
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: author.name,
        GIT_COMMITTER_EMAIL: author.email,
      });
      await named.run(commit);
    }
  }
}
