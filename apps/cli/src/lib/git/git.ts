import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { GitDidNotStartError, RepositoryError } from "./errors";

/** What one git call returned, and ways to read it. */
export class GitResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  /** Wraps what one call returned. */
  constructor(exitCode: number, stdout: string, stderr: string) {
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }

  /** Whether git exited 0. */
  succeeded(): boolean {
    return this.exitCode === 0;
  }

  /** What git printed, without its final line break. */
  text(): string {
    return this.stdout.replace(/\n$/, "");
  }

  /** The NUL-separated paths git printed, for a `-z` command. */
  paths(): string[] {
    return this.stdout.split("\0").filter((path) => path !== "");
  }

  /**
   * Everything git wrote to stderr, its own reason for failing; empty when it wrote none.
   *
   * All of it, not the first line: git's later lines often say how to fix the
   * failure, as a refusal over ownership names the `safe.directory` command.
   */
  reason(): string {
    return this.stderr.trim();
  }
}

/** The git command line, run in one directory with one environment. */
export class Git {
  /** The directory git runs in. */
  readonly dir: string;
  private readonly env: NodeJS.ProcessEnv;

  /** Runs git in `dir`, with `env` added to its environment. */
  constructor(dir: string, env: NodeJS.ProcessEnv = {}) {
    this.dir = dir;
    this.env = env;
  }

  /** The same git, with `env` added to its environment. */
  with(env: NodeJS.ProcessEnv): Git {
    return new Git(this.dir, { ...this.env, ...env });
  }

  /**
   * Runs git with `args`; throws a {@link RepositoryError} for an exit code other than 0 or `allow`.
   *
   * Every call is made safe the same way:
   * - `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are dropped from the
   *   inherited environment. A git hook sets them to its own repository, so a
   *   CLI run from a hook would otherwise act on that one.
   * - `LC_ALL=C`, so git answers in English and a failure is recognised by its
   *   wording (`Repository.open` looks for "not a git repository").
   * - `GIT_TERMINAL_PROMPT=0`, so git never waits on a prompt.
   * - `--literal-pathspecs`, so `app/[id].tsx` matches only itself and not `app/i.tsx`.
   * - Output is capped at 16 MB and a call at five minutes, so a stuck or
   *   runaway git cannot hang the CLI.
   *
   * An allowed exit code is an answer, not a failure. Only a git that ran and
   * exited has one, so no allow list can mistake a missing git for an answer;
   * that throws {@link GitDidNotStartError}. Every other failure carries git's
   * own message, or Node's when git wrote nothing.
   */
  run(args: readonly string[], allow: readonly number[] = []): Promise<GitResult> {
    const inherited = { ...process.env };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
      delete inherited[name];
    }
    const env = { ...inherited, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", ...this.env };
    return new Promise((resolveResult, reject) => {
      execFile(
        "git",
        ["--literal-pathspecs", ...args],
        { cwd: this.dir, env, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 },
        (error, stdout, stderr) => {
          const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          if (failure === null) {
            resolveResult(new GitResult(0, stdout, stderr));
            return;
          }
          const result = new GitResult(Number(failure.code), stdout, stderr);
          if (typeof failure.code === "number" && allow.includes(failure.code)) {
            resolveResult(result);
          } else if (failure.code === "ENOENT") {
            reject(new GitDidNotStartError(failure.message));
          } else if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            reject(new RepositoryError("git printed more than 16 MB"));
          } else if (failure.killed) {
            reject(new RepositoryError("git did not finish in time"));
          } else {
            reject(new RepositoryError(result.reason() || failure.message));
          }
        },
      );
    });
  }

  /**
   * Every file staged under the directory, relative to it.
   *
   * `--relative` both limits the list to the directory and names each path
   * from it, which is what `git reset -- <path>` resolves against: a path from
   * the repository root, handed back to reset from a subdirectory, matches
   * nothing and leaves the file staged. `--no-renames` lists both ends of a
   * rename, so neither escapes a check.
   */
  async stagedFiles(): Promise<string[]> {
    const staged = ["diff", "--cached", "-z", "--name-only", "--no-renames", "--relative"];
    return (await this.run(staged)).paths();
  }

  /** Whether `path`, relative to the directory, names something that exists. */
  exists(path: string): boolean {
    return path !== "" && existsSync(resolve(this.dir, path));
  }
}
