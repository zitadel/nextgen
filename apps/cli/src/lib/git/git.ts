import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { GitDidNotStartError, RepositoryError } from "./errors";

/**
 * What one git call returned, and ways to read it.
 *
 * A call returns one only when it succeeded or exited with a code the caller
 * allowed; anything else is thrown by {@link Git.run}. Reading lives here so
 * every caller reads git's output the same way: `paths()` for `-z` lists,
 * `text()` for one value, `reason()` for why it failed.
 */
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

/**
 * The git command line, run in one directory with one environment.
 *
 * The one place the CLI starts git. Every call goes through {@link run},
 * which makes it safe the same way (see there), so no caller can forget a
 * setting. It knows nothing about repositories or Zitadel: it runs git and
 * reads its answer. `with` gives the same git with more environment, which is
 * how a temporary staging area, a fallback author or an English locale is
 * applied to one call.
 */
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
   * - `GIT_LITERAL_PATHSPECS`, `GIT_GLOB_PATHSPECS`, `GIT_NOGLOB_PATHSPECS`
   *   and `GIT_ICASE_PATHSPECS` are dropped from the inherited environment.
   *   They change what every path given to git matches, and the literal one
   *   turns off the `:(exclude)` a commit uses to keep a secret out.
   * - `GIT_TERMINAL_PROMPT=0`, so git never waits on a prompt.
   * - Output is capped at 16 MB and a call at five minutes, so a stuck or
   *   runaway git cannot hang the CLI.
   *
   * `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` are honoured, as git
   * itself does: a build that keeps `.git` elsewhere names it this way. No
   * flag is set that git passes on to hooks, so a hook that runs during a
   * commit sees the developer's own settings: a path is made literal where it
   * is given ({@link Git.literal}), and the locale is set to English only for
   * the one call whose wording is read.
   *
   * Output is read as UTF-8 unless `encoding` says otherwise; `latin1` keeps
   * every byte as one character, for a path list that must go back to git
   * unchanged.
   *
   * An allowed exit code is an answer, not a failure. Only a git that ran and
   * exited has one, so no allow list can mistake a missing git for an answer;
   * that throws {@link GitDidNotStartError}. Every other failure carries git's
   * own message, or Node's when git wrote nothing.
   */
  run(
    args: readonly string[],
    allow: readonly number[] = [],
    encoding: "utf8" | "latin1" = "utf8",
  ): Promise<GitResult> {
    const inherited = { ...process.env };
    for (const name of [
      "GIT_LITERAL_PATHSPECS",
      "GIT_GLOB_PATHSPECS",
      "GIT_NOGLOB_PATHSPECS",
      "GIT_ICASE_PATHSPECS",
    ]) {
      delete inherited[name];
    }
    const env = { ...inherited, GIT_TERMINAL_PROMPT: "0", ...this.env };
    return new Promise((resolveResult, reject) => {
      execFile(
        "git",
        [...args],
        { cwd: this.dir, env, encoding, maxBuffer: 16 * 1024 * 1024, timeout: 5 * 60 * 1000 },
        (error, stdout, stderr) => {
          const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          if (failure === null) {
            resolveResult(new GitResult(0, stdout, stderr));
            return;
          }
          if (typeof failure.code === "number") {
            const result = new GitResult(failure.code, stdout, stderr);
            if (allow.includes(failure.code)) {
              resolveResult(result);
            } else {
              reject(new RepositoryError(result.reason() || failure.message));
            }
          } else if (failure.code === "ENOENT") {
            reject(new GitDidNotStartError(failure.message));
          } else if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            reject(new RepositoryError("git printed more than 16 MB"));
          } else if (failure.killed) {
            reject(new RepositoryError("git did not finish in time"));
          } else {
            reject(new RepositoryError(stderr.trim() || failure.message));
          }
        },
      );
    });
  }

  /**
   * Every file staged under the directory, relative to it.
   *
   * `--relative` both limits the list to the directory and names each path
   * from it, as a path filter expects. `--no-renames` lists both ends of a
   * rename, so neither escapes a check.
   */
  async stagedFiles(): Promise<string[]> {
    const staged = ["diff", "--cached", "-z", "--name-only", "--no-renames", "--relative"];
    return (await this.run(staged)).paths();
  }

  /**
   * `path` as a pathspec that matches only itself, so `app/[id].tsx` does not also match `app/i.tsx`.
   *
   * Set per path rather than with `--literal-pathspecs`, which git would pass
   * on to every hook it runs as `GIT_LITERAL_PATHSPECS`.
   */
  static literal(path: string): string {
    return `:(literal)${path}`;
  }

  /** Whether `path`, relative to the directory, names something that exists. */
  exists(path: string): boolean {
    return path !== "" && existsSync(resolve(this.dir, path));
  }
}
