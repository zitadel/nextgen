import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { Git } from "./git";
import type { Check } from "./operation";
import { CurrentCommit } from "./operations/current-commit";
import type { Author, PathFilter } from "./types";

/**
 * A temporary staging area (`GIT_INDEX_FILE`), so a commit or a diff is put
 * together without touching the developer's own, which may hold staged work
 * of theirs, another package's included.
 *
 * Made with {@link temporary}, which removes it however the work ends. A
 * commit starts it from the last commit ({@link startFromHead}); a diff starts
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

  /** Runs `work` with a new staging area for `git`'s directory, removed afterwards. */
  static async temporary<T>(git: Git, work: (staging: StagingArea) => Promise<T>): Promise<T> {
    const scratch = await mkdtemp(join(tmpdir(), "git-staging-"));
    try {
      return await work(new StagingArea(git, join(scratch, "index")));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /** Starts from the last commit, so a commit carries the rest of the repository unchanged; empty before one. */
  async startFromHead(): Promise<void> {
    const head = await new CurrentCommit().run(this.git);
    if (head !== null) {
      await this.git.run(["read-tree", head]);
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
   * Stages everything under the directory but what `except` matches, as `git add --all` would.
   *
   * The changed and untracked files are listed first and only the kept ones
   * are added, so an excluded file's content is never written to the object
   * store, where it would sit as a loose object until git cleans it up. The
   * list goes through a file beside the staging area rather than the command
   * line, which a project of thousands of files would overflow. A file that is
   * already tracked and excluded keeps what the last commit has.
   *
   * The list is read and written back byte for byte: a name that is not
   * valid UTF-8, which Linux allows, would otherwise come back changed and
   * match nothing. `except` sees each name as UTF-8.
   */
  async addAll(except: PathFilter): Promise<void> {
    const listed = await this.git.run(
      ["ls-files", "-z", "--modified", "--deleted", "--others", "--exclude-standard", "--", "."],
      [],
      "latin1",
    );
    const kept = listed
      .paths()
      .filter((path) => !except(Buffer.from(path, "latin1").toString("utf8")));
    if (kept.length > 0) {
      const list = join(dirname(this.index), "paths");
      await writeFile(list, Buffer.from(kept.join("\0"), "latin1"));
      await this.git.run(["add", "--all", `--pathspec-from-file=${list}`, "--pathspec-file-nul"]);
    }
  }

  /**
   * Marks the untracked files among `paths` "intent to add", so a diff shows them as added.
   *
   * Intent to add records the file without its content, so nothing is written
   * to the object store. Only paths that exist are passed: `git add` refuses
   * the whole call when one matches nothing. An ignored path makes it mark the
   * rest and exit 1, which is accepted.
   */
  async markAsAdded(paths: readonly string[]): Promise<void> {
    const present = paths.filter((path) => this.git.exists(path));
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
