import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { GitDidNotStartError, RepositoryError } from "./errors";

/** The output git may print for one call before it is cut off. */
const MAX_OUTPUT = 16 * 1024 * 1024;

/** How long one call may take before it is stopped, so a stuck git cannot hang the CLI. */
const TIMEOUT_MS = 5 * 60 * 1000;

/** Settings passed with every call. */
const SAFE_SETTINGS = [
  // Take paths literally, so `app/[id].tsx` matches only itself and not `app/i.tsx`.
  "--literal-pathspecs",
];

/** Inherited variables dropped from every call: a git hook sets them to point at its own repository. */
const DROPPED_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

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

  /** What git printed, or null when it did not exit 0. */
  textIfSucceeded(): string | null {
    if (!this.succeeded()) {
      return null;
    }
    return this.text();
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
    const inherited = { ...process.env };
    for (const name of DROPPED_VARIABLES) {
      delete inherited[name];
    }
    // English messages, so a failure is recognised by its wording; never a prompt.
    const env = { ...inherited, LC_ALL: "C", GIT_TERMINAL_PROMPT: "0", ...this.env };
    return new Promise((resolveResult, reject) => {
      execFile(
        "git",
        [...SAFE_SETTINGS, ...args],
        { cwd: this.dir, env, maxBuffer: MAX_OUTPUT, timeout: TIMEOUT_MS },
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
          } else if (failure.killed) {
            reject(new RepositoryError("git did not finish in time"));
          } else {
            reject(new RepositoryError(result.reason() || failure.message));
          }
        },
      );
    });
  }

  /** Whether `path`, relative to the directory, names something that exists. */
  exists(path: string): boolean {
    return path !== "" && existsSync(resolve(this.dir, path));
  }
}
