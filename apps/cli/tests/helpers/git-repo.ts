import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { vi } from "vitest";

import { RepositoryError } from "../../src/lib/git/errors";
import { Git, GitResult } from "../../src/lib/git/git";

const exec = promisify(execFile);

/**
 * Temporary directories and repositories for tests that drive real git. Every
 * git call here turns signing and hooks off and carries its own identity, so a
 * developer's global config (a signing key, a global `core.hooksPath`) can
 * neither block the suite on a prompt nor change what it commits. The arrange
 * steps call git directly rather than through `src/lib/git`, so that module is
 * never what checks itself.
 */
export class GitScratch {
  private readonly dirs: string[] = [];

  /** An empty directory, in no repository. */
  async directory(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-git-test-"));
    this.dirs.push(dir);
    return dir;
  }

  /** A new repository with no commit. */
  async repository(): Promise<string> {
    const dir = await this.directory();
    await git(dir, "init", "--quiet");
    return dir;
  }

  /** A repository holding `files`, all committed. */
  async committed(files: Record<string, string>): Promise<string> {
    const dir = await this.repository();
    await write(dir, files);
    await commitAll(dir, "initial");
    return dir;
  }

  /** A `git` on PATH that prints `stderr` and exits `exitCode` whatever it is asked. Returns its directory. */
  async brokenGit(stderr = "git: not available", exitCode = 1): Promise<string> {
    const dir = await this.directory();
    await writeFile(join(dir, "git"), `#!/bin/sh\nprintf '%s' '${stderr}' >&2\nexit ${exitCode}\n`);
    await chmod(join(dir, "git"), 0o755);
    return dir;
  }

  async cleanup(): Promise<void> {
    await Promise.all(this.dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  }
}

/** Run git in `cwd` as the test's own identity, returning its stdout. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await exec(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.quotePath=false",
      ...args,
    ],
    { cwd },
  );
  return stdout;
}

/** Write each file under `dir`, creating directories as needed. */
export async function write(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), content);
  }
}

/** Stage and commit everything in the repository at `cwd`. */
export async function commitAll(cwd: string, message: string): Promise<void> {
  await git(cwd, "add", "--all");
  await git(cwd, "commit", "--quiet", "--no-verify", `--message=${message}`);
}

/** The files the commit at HEAD has in its tree, from the repository root. */
export async function treeFiles(cwd: string): Promise<string[]> {
  return lines(await git(cwd, "ls-tree", "-r", "-z", "--full-tree", "--name-only", "HEAD"), "\0");
}

/** The files HEAD's commit changed, from the repository root. */
export async function headChanges(cwd: string): Promise<string[]> {
  return lines(
    await git(cwd, "diff-tree", "--no-commit-id", "--root", "-r", "-z", "--name-only", "HEAD"),
    "\0",
  );
}

/** The paths staged in the real index, from the repository root. */
export async function stagedFiles(cwd: string): Promise<string[]> {
  return lines(await git(cwd, "diff", "--cached", "-z", "--name-only"), "\0");
}

function lines(stdout: string, separator: string): string[] {
  return stdout.split(separator).filter((line) => line.trim() !== "");
}

/**
 * Keeps the developer's own git setup out of a test that runs the module on
 * real git: no global or system config (a global hook, `diff.renames=false`)
 * and no inherited repository, identity or editor, as a git hook running the
 * suite would set. Call it in `beforeEach`.
 */
export function isolateGit(): void {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  for (const name of [
    "GIT_DIR",
    "GIT_WORK_TREE",
    "GIT_INDEX_FILE",
    "GIT_CONFIG_PARAMETERS",
    "GIT_CONFIG_COUNT",
    "EMAIL",
    "GIT_AUTHOR_NAME",
    "GIT_AUTHOR_EMAIL",
    "GIT_COMMITTER_NAME",
    "GIT_COMMITTER_EMAIL",
    "GIT_SEQUENCE_EDITOR",
  ]) {
    vi.stubEnv(name, undefined);
  }
}

/** What a {@link fakeGit} answers for one call. */
interface Answer {
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

/** A `Git` that runs nothing and answers every call from `answer`. */
class FakeGit extends Git {
  private readonly answer: (args: readonly string[]) => Answer;
  private readonly existing: readonly string[];

  /** Answers from `answer`; of paths, only `existing` exist. */
  constructor(answer: (args: readonly string[]) => Answer, existing: readonly string[]) {
    super("/fake");
    this.answer = answer;
    this.existing = existing;
  }

  /** The same fake, whatever is added to its environment. */
  override with(): Git {
    return this;
  }

  /** What `answer` gives; throws, as git would, for an exit code other than 0 or `allow`. */
  override async run(args: readonly string[], allow: readonly number[] = []): Promise<GitResult> {
    const { exitCode = 0, stdout = "", stderr = "" } = this.answer(args);
    const result = new GitResult(exitCode, stdout, stderr);
    if (exitCode !== 0 && !allow.includes(exitCode)) {
      throw new RepositoryError(result.reason());
    }
    return result;
  }

  /** Whether `path` is one of the existing ones. */
  override exists(path: string): boolean {
    return this.existing.includes(path);
  }
}

/**
 * A stand-in for `Git` that answers every call with what `answer` returns for
 * its arguments, so a check or an operation can be tested on every outcome
 * without building a repository for each.
 */
export function fakeGit(
  answer: (args: readonly string[]) => Answer,
  existing: readonly string[] = [],
): Git {
  return new FakeGit(answer, existing);
}
