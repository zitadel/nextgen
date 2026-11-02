import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { Command } from "@oclif/core";
import { describe, expect } from "vitest";

import { it } from "../../../helpers/fixtures";

import { deployMessage, messageFlag } from "../../../../src/lib/release/message";

const run = promisify(execFile);

/** A temp git repo whose one clean commit has `subject`. */
async function aRepo(dir: string, subject = "add company"): Promise<string> {
  const git = (args: string[]): Promise<unknown> => run("git", args, { cwd: dir });
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await writeFile(join(dir, "README.md"), "# app\n");
  await git(["add", "."]);
  await git(["commit", "-q", "-m", subject]);
  return dir;
}

/** A GitHub pull_request event payload on disk, as the runner writes it. */
async function aPullRequestEvent(dir: string, title: string): Promise<string> {
  const path = join(dir, "event.json");
  await writeFile(path, JSON.stringify({ pull_request: { title } }));
  return path;
}

describe("deployMessage", () => {
  it("takes -m over everything else", async ({ dir }) => {
    const cwd = await aRepo(dir);

    expect(await deployMessage("fix sign-up", cwd, {})).toBe("fix sign-up");
  });

  it("falls back to the commit subject on a clean worktree", async ({ dir }) => {
    const cwd = await aRepo(dir);

    expect(await deployMessage(undefined, cwd, {})).toBe("add company");
  });

  it("records nothing for a dirty worktree", async ({ dir }) => {
    const cwd = await aRepo(dir);
    await writeFile(join(cwd, "README.md"), "# edited\n");

    expect(await deployMessage(undefined, cwd, {})).toBeUndefined();
  });

  it("records nothing outside a git repository", async ({ dir }) => {
    expect(await deployMessage(undefined, dir, {})).toBeUndefined();
  });

  it("takes a GitHub pull request's title over the merge commit's subject", async ({ dir }) => {
    const cwd = await aRepo(dir, "Merge 1a2b into 3c4d");
    const event = await aPullRequestEvent(cwd, "feat: add company");

    expect(
      await deployMessage(undefined, cwd, {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: event,
      }),
    ).toBe("feat: add company");
  });

  it("records nothing for a GitHub pull request whose event cannot be read", async ({ dir }) => {
    const cwd = await aRepo(dir, "Merge 1a2b into 3c4d");

    expect(
      await deployMessage(undefined, cwd, {
        GITHUB_EVENT_NAME: "pull_request",
        GITHUB_EVENT_PATH: join(cwd, "missing.json"),
      }),
    ).toBeUndefined();
  });

  it("takes the first line of Vercel's commit message", async ({ dir }) => {
    const cwd = await aRepo(dir);

    expect(
      await deployMessage(undefined, cwd, {
        VERCEL_GIT_COMMIT_MESSAGE: "feat: add company\n\nCo-authored-by: someone",
      }),
    ).toBe("feat: add company");
  });

  it("cuts a long subject by code points, never splitting one", async ({ dir }) => {
    const cwd = await aRepo(dir, `${"x".repeat(1023)}😀😀`);

    const message = await deployMessage(undefined, cwd, {});

    expect(Array.from(message ?? "")).toHaveLength(1024);
    expect(message?.endsWith("😀")).toBe(true);
  });
});

describe("messageFlag", () => {
  class Probe extends Command {
    static override flags = { message: messageFlag("A message.") };
    async run(): Promise<string | undefined> {
      const { flags } = await this.parse(Probe);
      return flags.message;
    }
  }

  it("refuses a blank message", async () => {
    await expect(Probe.run(["-m", "   "])).rejects.toThrow("the value is empty");
  });

  it("refuses a message longer than the server records", async () => {
    await expect(Probe.run(["-m", "x".repeat(1025)])).rejects.toThrow("longer than 1024");
  });

  it("trims a message", async () => {
    expect(await Probe.run(["-m", "  add company  "])).toBe("add company");
  });
});
