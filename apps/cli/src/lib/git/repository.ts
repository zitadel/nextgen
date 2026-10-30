import { existsSync } from "node:fs";

import { GitDidNotStartError, RepositoryError } from "./errors";
import { Git } from "./git";
import type { Operation } from "./operation";
import { CommitAll } from "./operations/commit-all";
import { CurrentCommit } from "./operations/current-commit";
import { DiffFilesSince } from "./operations/diff-files-since";
import { DiffSince } from "./operations/diff-since";
import { IsDirty } from "./operations/is-dirty";
import { UncommittedFiles } from "./operations/uncommitted-files";
import type {
  CommitOptions,
  CommitOutcome,
  DiffedFile,
  DiffOptions,
  UncommittedFile,
} from "./types";

/**
 * The git repository a directory is in, seen from that directory.
 *
 * In a monorepo the repository may start several levels up; everything here
 * is limited to the directory and names paths relative to it, except
 * {@link isDirty}, which looks at the whole repository. When git fails, a
 * method throws a `RepositoryError` carrying git's own message.
 *
 * Each method is one {@link Operation}: its checks run first, and the first
 * one that fails decides the answer through the operation's `refused`.
 */
export class Repository {
  private readonly git: Git;
  /** Where the directory sits in the repository, e.g. `apps/web/`, or `""` at its root. */
  private readonly prefix: string;

  /** Creates the handle; use {@link Repository.open} or {@link Repository.create}. */
  private constructor(dir: string, prefix: string) {
    this.git = new Git(dir);
    this.prefix = prefix;
  }

  /**
   * The repository `dir` is in, or null when it is in none, does not exist, or there is no git.
   *
   * Only those three mean "no repository". Any other failure, such as a
   * refusal over ownership or a broken `HOME`, is thrown: answering "none"
   * would let a caller `git init` a second repository inside the first, or
   * skip a check that the tree is clean.
   */
  static async open(dir: string): Promise<Repository | null> {
    if (!existsSync(dir)) {
      return null;
    }
    const result = await new Git(dir)
      .run(["rev-parse", "--show-prefix"], [128])
      .catch((error: unknown) => {
        if (error instanceof GitDidNotStartError) {
          return null;
        }
        throw error;
      });
    if (result === null) {
      return null;
    }
    if (/^fatal: not a git repository/m.test(result.stderr)) {
      return null;
    }
    if (!result.succeeded()) {
      throw new RepositoryError(result.reason());
    }
    return new Repository(dir, result.text());
  }

  /** A new repository in `dir`. */
  static async create(dir: string): Promise<Repository> {
    await new Git(dir).run(["init", "--quiet"]);
    return new Repository(dir, "");
  }

  /** The commit it is at, or null before its first commit. */
  currentCommit(): Promise<string | null> {
    return this.perform(new CurrentCommit());
  }

  /** Whether anything in the whole repository is uncommitted. */
  isDirty(): Promise<boolean> {
    return this.perform(new IsDirty());
  }

  /** The uncommitted files under the directory, untracked ones included. */
  uncommittedFiles(): Promise<UncommittedFile[]> {
    return this.perform(new UncommittedFiles(this.prefix));
  }

  /**
   * Commits everything under the directory but `options.except`; see {@link CommitAll}.
   *
   * Meant for a directory with nothing uncommitted of the developer's own:
   * check {@link uncommittedFiles} first. Afterwards the developer's staging
   * area under the directory is reset to the new commit, so anything they had
   * staged there would be unstaged.
   */
  commitAll(message: string, options: CommitOptions): Promise<CommitOutcome> {
    return this.perform(new CommitAll(message, options));
  }

  /** The diff of `paths` since `commit`, untracked files as added, or null when that commit is not here. */
  diffSince(
    commit: string,
    paths: readonly string[],
    options: DiffOptions,
  ): Promise<string | null> {
    return this.perform(new DiffSince(commit, paths, options));
  }

  /** {@link diffSince}, uncoloured and split into one entry per changed file. */
  diffFilesSince(commit: string, paths: readonly string[]): Promise<DiffedFile[] | null> {
    return this.perform(new DiffFilesSince(commit, paths));
  }

  /** Runs `operation` once all its checks hold; what it returns when refused, otherwise. */
  private async perform<T>(operation: Operation<T>): Promise<T> {
    for (const check of operation.checks()) {
      const problem = await check.problem(this.git);
      if (problem !== null) {
        return operation.refused(problem);
      }
    }
    return operation.run(this.git);
  }
}
