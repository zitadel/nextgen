import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { STAGED_FILES } from "./checks/staged-files";
import type { Git } from "./git";
import type { Check } from "./operation";
import type { PathFilter } from "./types";

/**
 * A temporary staging area, so a commit or a diff is put together without
 * touching the developer's own, which may hold staged work of theirs.
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
    const scratch = await mkdtemp(join(tmpdir(), "zitadel-git-"));
    try {
      return await work(new StagingArea(git, join(scratch, "index")));
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }

  /** Starts from the last commit, so a commit carries the rest of the repository unchanged; empty before one. */
  async startFromHead(): Promise<void> {
    const head = (
      await this.git.run(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"], [1])
    ).textIfSucceeded();
    if (head !== null) {
      await this.git.run(["read-tree", head]);
    }
  }

  /** Starts as a copy of the developer's staging area, keeping its timestamps. */
  async startFromDevelopers(developers: Git): Promise<void> {
    // The timestamps matter: git trusts an index entry only for files older
    // than the index, so a copy stamped now would hide an edit made in the
    // same second. A fresh repository has no index yet; the copy then starts empty.
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

  /** Marks the untracked files among `paths` "intent to add", so a diff shows them as added. */
  async markAsAdded(paths: readonly string[]): Promise<void> {
    // `git add` refuses the whole call when one path matches nothing. For an
    // ignored path it marks the rest and exits 1, which is fine here.
    const present = paths.filter((path) => this.git.exists(path));
    if (present.length > 0) {
      await this.git.run(["add", "--intent-to-add", "--", ...present], [1]);
    }
  }

  /** Takes every staged file `except` matches back out, to what the last commit has. */
  async unstage(except: PathFilter): Promise<void> {
    // `git reset` with no path would take everything out.
    const unwanted = (await this.git.run(STAGED_FILES)).paths().filter(except);
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

  /** Commits what is staged with `message`, with `identity` added to git's environment. */
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
