import { realpath } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { GitDidNotStartError, RepositoryError } from "../../../../src/lib/git/errors";
import { Git, GitResult } from "../../../../src/lib/git/git";
import { GitScratch, write } from "../../../helpers/git-repo";

const scratch = new GitScratch();

/** What git printed, through the module's runner. */
async function git(cwd: string, args: string[]): Promise<string> {
  return (await new Git(cwd).run(args)).stdout;
}

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

  it("names git's first line in its error, in English whatever the locale", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("LC_ALL", "de_DE.UTF-8");
    vi.stubEnv("LANGUAGE", "de");

    await expect(git(cwd, ["log"])).rejects.toThrow(/^fatal: not a git repository/);
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

  it("gives no text when git did not exit 0", () => {
    expect(new GitResult(1, "abc\n", "").textIfSucceeded()).toBeNull();
  });

  it("splits NUL-separated paths", () => {
    expect(new GitResult(0, "a\0b c\0", "").paths()).toEqual(["a", "b c"]);
  });

  it("gives git's first line on stderr as its reason", () => {
    expect(new GitResult(128, "", "fatal: one\nhint: two\n").reason()).toBe("fatal: one");
  });
});
