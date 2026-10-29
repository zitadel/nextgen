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

  /** The first line git wrote to stderr, its own reason for failing; empty when it wrote none. */
  reason(): string {
    return this.stderr.trim().split("\n")[0] ?? "";
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

  /** Runs git with `args`; throws a {@link RepositoryError} for an exit code other than 0 or `allow`. */
  run(args: readonly string[], allow: readonly number[] = []): Promise<GitResult> {
    // A git hook sets these to point at its own repository.
    const inherited = { ...process.env };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) {
      delete inherited[name];
    }
    // English messages, so a failure is recognised by its wording; never a prompt.
    const env = { ...inherited, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", ...this.env };
    return new Promise((resolveResult, reject) => {
      execFile(
        "git",
        // Paths are taken literally, so `app/[id].tsx` matches only itself and not `app/i.tsx`.
        ["--literal-pathspecs", ...args],
        // A stuck git is stopped after five minutes rather than hang the CLI.
        { cwd: this.dir, env, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 },
        (error, stdout, stderr) => {
          const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          if (failure === null) {
            resolveResult(new GitResult(0, stdout, stderr));
            return;
          }
          // The exit code is a number when git ran; a string such as ENOENT when it did not.
          let exitCode = -1;
          if (typeof failure.code === "number") {
            exitCode = failure.code;
          }
          const result = new GitResult(exitCode, stdout, stderr);
          if (allow.includes(exitCode)) {
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

  /** Every file staged under the directory, relative to it. */
  async stagedFiles(): Promise<string[]> {
    const staged = ["diff", "--cached", "-z", "--name-only", "--no-renames", "--relative"];
    return (await this.run(staged)).paths();
  }

  /** Whether `path`, relative to the directory, names something that exists. */
  exists(path: string): boolean {
    return path !== "" && existsSync(resolve(this.dir, path));
  }
}
