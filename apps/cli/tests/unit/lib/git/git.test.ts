import { chmod, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GitDidNotStartError, RepositoryError } from "../../../../src/lib/git/errors";
import { Git, GitResult } from "../../../../src/lib/git/git";
import { GitScratch, isolateGit, write } from "../../../helpers/git-repo";

const scratch = new GitScratch();

/** What git printed, through the module's runner. */
async function git(cwd: string, args: string[]): Promise<string> {
  return (await new Git(cwd).run(args)).stdout;
}

beforeEach(isolateGit);

afterEach(async () => {
  vi.unstubAllEnvs();
  await scratch.cleanup();
});

describe("Git", () => {
  it("returns an exit code it was told to accept as an answer", async () => {
    const cwd = await scratch.repository();

    const result = await new Git(cwd).run(["rev-parse", "--verify", "--quiet", "HEAD"], [1]);

    expect(result.exitCode).toBe(1);
  });

  it("throws a RepositoryError for any other exit code", async () => {
    const cwd = await scratch.repository();

    await expect(git(cwd, ["rev-parse", "--verify", "--quiet", "HEAD"])).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });

  it("takes a path with glob characters literally", async () => {
    const cwd = await scratch.repository();
    await write(cwd, { "app/[id].tsx": "", "app/i.tsx": "", "app/d.tsx": "" });

    await git(cwd, ["add", "--", "app/[id].tsx"]);

    expect(await git(cwd, ["diff", "--cached", "--name-only"])).toBe("app/[id].tsx\n");
  });

  it("acts on the repository it runs in, not one an inherited GIT_DIR names", async () => {
    const other = await scratch.repository();
    const cwd = await scratch.repository();
    vi.stubEnv("GIT_DIR", join(other, ".git"));

    expect((await git(cwd, ["rev-parse", "--absolute-git-dir"])).trim()).toBe(
      await realpath(join(cwd, ".git")),
    );
  });

  it("acts on its own work tree, not one an inherited GIT_WORK_TREE names", async () => {
    const other = await scratch.repository();
    const cwd = await scratch.repository();
    vi.stubEnv("GIT_WORK_TREE", other);

    expect((await git(cwd, ["rev-parse", "--show-toplevel"])).trim()).toBe(await realpath(cwd));
  });

  it("uses its own staging area, not one an inherited GIT_INDEX_FILE names", async () => {
    const cwd = await scratch.repository();
    vi.stubEnv("GIT_INDEX_FILE", join(await scratch.directory(), "index"));

    expect((await git(cwd, ["rev-parse", "--git-path", "index"])).trim()).toBe(".git/index");
  });

  it("names git's own error when git wrote nothing to stderr", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await scratch.brokenGit(""));

    await expect(git(cwd, ["status"])).rejects.toThrow("Command failed");
  });

  it("takes in a few megabytes of output", async () => {
    const cwd = await scratch.committed({ "big.txt": "x".repeat(2 * 1024 * 1024) });

    expect((await git(cwd, ["show", "HEAD:big.txt"])).length).toBe(2 * 1024 * 1024);
  });

  it("says so when git prints more than it may", async () => {
    const cwd = await scratch.committed({ "big.txt": "x".repeat(17 * 1024 * 1024) });

    await expect(git(cwd, ["show", "HEAD:big.txt"])).rejects.toThrow("git printed more than 16 MB");
  });

  it("lists the files staged under the directory, relative to it", async () => {
    const root = await scratch.committed({ "README.md": "r\n" });
    await write(root, { "apps/web/a.txt": "a\n", "apps/api/b.txt": "b\n" });
    await new Git(root).run(["add", "--all"]);

    expect(await new Git(join(root, "apps/web")).stagedFiles()).toEqual(["a.txt"]);
  });

  it("does not take an empty path to exist", async () => {
    expect(new Git(await scratch.directory()).exists("")).toBe(false);
  });

  it("names git's first line in its error", async () => {
    await expect(git(await scratch.directory(), ["log"])).rejects.toThrow(
      /^fatal: not a git repository/,
    );
  });

  it("runs git in English whatever the locale", async () => {
    const bin = await scratch.directory();
    await writeFile(join(bin, "git"), '#!/bin/sh\necho "$LC_ALL" >&2\nexit 1\n');
    await chmod(join(bin, "git"), 0o755);
    vi.stubEnv("LC_ALL", "de_DE.UTF-8");
    vi.stubEnv("PATH", bin);

    await expect(git(await scratch.directory(), ["log"])).rejects.toThrow(/^C$/);
  });

  it("throws a GitDidNotStartError when there is no git on PATH", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await scratch.directory());

    await expect(git(cwd, ["status"])).rejects.toBeInstanceOf(GitDidNotStartError);
  });

  it("names git's first line for any other failure", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await scratch.brokenGit());

    await expect(git(cwd, ["status"])).rejects.toThrow("git: not available");
  });
});

describe("GitResult", () => {
  it("gives its text without the final line break", () => {
    expect(new GitResult(0, "abc\n", "").text()).toBe("abc");
  });

  it("has succeeded only when git exited 0", () => {
    expect([new GitResult(0, "", "").succeeded(), new GitResult(1, "", "").succeeded()]).toEqual([
      true,
      false,
    ]);
  });

  it("splits NUL-separated paths", () => {
    expect(new GitResult(0, "a\0b c\0", "").paths()).toEqual(["a", "b c"]);
  });

  it("gives git's first line on stderr as its reason", () => {
    expect(new GitResult(128, "", "fatal: one\nhint: two\n").reason()).toBe("fatal: one");
  });
});
