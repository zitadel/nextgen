import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Git } from "./git";
import type { Check } from "./operation";
import { CurrentCommit } from "./operations/current-commit";
import type { PathFilter } from "./types";

/**
 * A temporary staging area (`GIT_INDEX_FILE`), so a commit or a diff is put
 * together without touching the developer's own, which may hold staged work
 * of theirs, another package's included.
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

  /** Stages everything under the directory, as `git add --all` does. */
  async addAll(): Promise<void> {
    await this.git.run(["add", "--all", "--", "."]);
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

  /**
   * Takes every staged file `except` matches back out, to what the last commit has.
   *
   * Nothing is reset when nothing matches: `git reset` with no path would take
   * everything out.
   */
  async unstage(except: PathFilter): Promise<void> {
    const unwanted = (await this.git.stagedFiles()).filter(except);
    if (unwanted.length > 0) {
      await this.git.run(["reset", "--quiet", "--", ...unwanted]);
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
   * Commits what is staged with `message`, with `identity` added to git's environment.
   *
   * Signing is turned off, so a configured key cannot block on a passphrase
   * prompt. `--no-verify` skips the pre-commit and commit-msg hooks, which a
   * scaffolded app's linter would otherwise fail; post-commit hooks still run,
   * as they always did.
   */
  async commit(message: string, identity: NodeJS.ProcessEnv): Promise<void> {
    const commit = [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--quiet",
      "--no-verify",
      `--message=${message}`,
    ];
    await this.git.with(identity).run(commit);
  }
}
