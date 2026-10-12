import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { worktreeIsDirty } from "../../../../src/lib/release/git";

const run = promisify(execFile);

let dir: string;

/** A temp git repo with one clean commit holding a `.zitadel/` file. */
async function cleanRepo(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "zitadel-git-"));
  await mkdir(join(dir, ".zitadel"), { recursive: true });
  await writeFile(join(dir, ".zitadel", "marker.json"), "{}");
  await writeFile(join(dir, "README.md"), "# app\n");
  const git = (args: string[]): Promise<unknown> => run("git", args, { cwd: dir });
  await git(["init", "-q"]);
  await git(["config", "user.email", "test@example.com"]);
  await git(["config", "user.name", "Test"]);
  await git(["add", "."]);
  await git(["commit", "-q", "-m", "initial"]);
  return dir;
}

afterEach(async () => {
  if (dir) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("worktreeIsDirty", () => {
  it("is false for a clean worktree", async () => {
    const cwd = await cleanRepo();

    expect(await worktreeIsDirty(cwd)).toBe(false);
  });

  it("is true for an uncommitted change outside .zitadel/", async () => {
    const cwd = await cleanRepo();

    // The change is in the repo but not under `.zitadel/`: the whole worktree
    // is dirty, which the old `.zitadel/`-only check would have missed.
    await writeFile(join(cwd, "README.md"), "# app\n\nedited\n");

    expect(await worktreeIsDirty(cwd)).toBe(true);
  });

  it("is false when there is no git repository", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "zitadel-git-norepo-"));
    dir = cwd;

    expect(await worktreeIsDirty(cwd)).toBe(false);
  });
});
