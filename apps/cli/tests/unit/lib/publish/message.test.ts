import { join } from "node:path";

import { describe, expect } from "vitest";

import { deployMessage } from "@/lib/publish/message";
import { it } from "@tests/helpers/fixtures";
import { commitAll, git, write } from "@tests/helpers/git-repo";

/**
 * The subject of a merge commit, which says nothing about the change.
 */
const MERGE_SUBJECT = "Merge 1a2b into 3c4d";

/**
 * Makes `dir` a repository whose one clean commit has `subject`.
 *
 * @param dir - The directory to make a repository of.
 * @param subject - The commit's subject.
 * @returns The directory.
 */
async function aRepo(dir: string, subject = "add company"): Promise<string> {
  await git(dir, "init", "--quiet");
  await write(dir, { "README.md": "# app\n" });
  await commitAll(dir, subject);
  return dir;
}

describe("deployMessage", () => {
  it("takes -m over everything else", async ({ dir }) => {
    const cwd = await aRepo(dir);

    const message = await deployMessage("fix sign-up", cwd, {});

    expect(message).toBe("fix sign-up");
  });

  it("cuts a long subject to 1024 code points", async ({ dir }) => {
    const cwd = await aRepo(dir, `${"x".repeat(1023)}😀😀`);

    const message = await deployMessage(undefined, cwd, {});

    expect(Array.from(message ?? "")).toHaveLength(1024);
  });

  it("cuts a long subject without splitting a code point", async ({ dir }) => {
    const cwd = await aRepo(dir, `${"x".repeat(1023)}😀😀`);

    const message = await deployMessage(undefined, cwd, {});

    expect(message?.endsWith("😀")).toBe(true);
  });

  describe("with a clean worktree", () => {
    it("falls back to the commit subject", async ({ dir }) => {
      const cwd = await aRepo(dir);

      const message = await deployMessage(undefined, cwd, {});

      expect(message).toBe("add company");
    });
  });

  describe("with a dirty worktree", () => {
    it("records nothing", async ({ dir }) => {
      const cwd = await aRepo(dir);
      await write(cwd, { "README.md": "# edited\n" });

      const message = await deployMessage(undefined, cwd, {});

      expect(message).toBeUndefined();
    });
  });

  describe("outside a git repository", () => {
    it("records nothing", async ({ dir }) => {
      const message = await deployMessage(undefined, dir, {});

      expect(message).toBeUndefined();
    });
  });

  describe("when a GitHub pull request runs it", () => {
    it("takes the pull request's title over the merge commit's subject", async ({ dir }) => {
      const cwd = await aRepo(dir, MERGE_SUBJECT);
      await write(cwd, {
        "event.json": JSON.stringify({ pull_request: { title: "feat: add company" } }),
      });

      const message = await deployMessage(undefined, cwd, {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: join(cwd, "event.json"),
      });

      expect(message).toBe("feat: add company");
    });

    it("records nothing when its event cannot be read", async ({ dir }) => {
      const cwd = await aRepo(dir, MERGE_SUBJECT);

      const message = await deployMessage(undefined, cwd, {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: join(cwd, "missing.json"),
      });

      expect(message).toBeUndefined();
    });
  });

  describe("when Vercel builds it", () => {
    it("takes the first line of the commit message", async ({ dir }) => {
      const cwd = await aRepo(dir);

      const message = await deployMessage(undefined, cwd, {
        VERCEL_GIT_COMMIT_MESSAGE: "feat: add company\n\nCo-authored-by: someone",
      });

      expect(message).toBe("feat: add company");
    });
  });
});
