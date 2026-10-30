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

  it("takes a path made literal as only itself", async () => {
    const cwd = await scratch.repository();
    await write(cwd, { "app/[id].tsx": "", "app/i.tsx": "", "app/d.tsx": "" });

    await git(cwd, ["add", "--", Git.literal("app/[id].tsx")]);

    expect(await git(cwd, ["diff", "--cached", "--name-only"])).toBe("app/[id].tsx\n");
  });

  it("acts on the repository an inherited GIT_DIR names, as git does", async () => {
    const other = await scratch.repository();
    const cwd = await scratch.repository();
    vi.stubEnv("GIT_DIR", join(other, ".git"));

    expect((await git(cwd, ["rev-parse", "--absolute-git-dir"])).trim()).toBe(
      await realpath(join(other, ".git")),
    );
  });

  it("uses the staging area an inherited GIT_INDEX_FILE names, as git does", async () => {
    const cwd = await scratch.repository();
    const index = join(await scratch.directory(), "index");
    vi.stubEnv("GIT_INDEX_FILE", index);

    expect((await git(cwd, ["rev-parse", "--git-path", "index"])).trim()).toBe(index);
  });

  it.each([["GIT_ICASE_PATHSPECS"], ["GIT_GLOB_PATHSPECS"], ["GIT_NOGLOB_PATHSPECS"]])(
    "still takes paths when %s is inherited",
    async (name) => {
      const cwd = await scratch.committed({ "a.txt": "a\n" });
      vi.stubEnv(name, "1");

      expect(await git(cwd, ["ls-files", "--", Git.literal("a.txt")])).toBe("a.txt\n");
    },
  );

  it("still honours :(exclude) when GIT_LITERAL_PATHSPECS is inherited", async () => {
    const cwd = await scratch.committed({ "a.txt": "a\n", ".env": "S=1\n" });
    vi.stubEnv("GIT_LITERAL_PATHSPECS", "1");

    expect(await git(cwd, ["ls-files", "--", ".", ":(exclude,literal).env"])).toBe("a.txt\n");
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

  it("names git's message in its error", async () => {
    vi.stubEnv("LC_ALL", "C");

    await expect(git(await scratch.directory(), ["log"])).rejects.toThrow(
      /^fatal: not a git repository/,
    );
  });

  it("leaves git in the developer's own locale", async () => {
    const bin = await scratch.directory();
    await writeFile(join(bin, "git"), '#!/bin/sh\necho "$LC_ALL" >&2\nexit 1\n');
    await chmod(join(bin, "git"), 0o755);
    vi.stubEnv("LC_ALL", "de_DE.UTF-8");
    vi.stubEnv("PATH", bin);

    await expect(git(await scratch.directory(), ["log"])).rejects.toThrow(/^de_DE\.UTF-8$/);
  });

  it("throws a GitDidNotStartError when there is no git on PATH", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await scratch.directory());

    await expect(git(cwd, ["status"])).rejects.toBeInstanceOf(GitDidNotStartError);
  });

  it("throws when git is stopped by a signal, even where exit 0 is allowed", async () => {
    const bin = await scratch.directory();
    await writeFile(join(bin, "git"), "#!/bin/sh\nkill -TERM $$\n");
    await chmod(join(bin, "git"), 0o755);
    vi.stubEnv("PATH", bin);

    await expect(new Git(await scratch.directory()).run(["status"], [0])).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });

  it("throws a GitDidNotStartError even where exit 1 is allowed", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await scratch.directory());

    await expect(new Git(cwd).run(["status"], [1])).rejects.toBeInstanceOf(GitDidNotStartError);
  });

  it("names all of git's message, how to fix it included", async () => {
    const cwd = await scratch.directory();
    vi.stubEnv("PATH", await scratch.brokenGit("fatal: refused\nhint: run this to fix it", 128));

    await expect(git(cwd, ["status"])).rejects.toThrow("fatal: refused\nhint: run this to fix it");
  });

  it("names git's message for any other failure", async () => {
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

  it("gives all of git's stderr as its reason", () => {
    expect(new GitResult(128, "", "fatal: one\nhint: two\n").reason()).toBe(
      "fatal: one\nhint: two",
    );
  });
});
