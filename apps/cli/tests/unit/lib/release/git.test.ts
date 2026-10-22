import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { diffConfigAgainst, worktreeIsDirty } from "../../../../src/lib/release/git";

const run = promisify(execFile);

let dir: string;

/** A temp git repo with one clean commit holding a `.zitadel/` file. */
async function cleanRepo(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), "zitadel-git-"));
  await mkdir(join(dir, ".zitadel", "schemas"), { recursive: true });
  await writeFile(join(dir, ".zitadel", "schemas", "marker.json"), "{}");
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

describe("diffConfigAgainst", () => {
  it("shows an untracked .zitadel/ file as an addition", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();

    // A brand-new resource is untracked; the release bundle would include it,
    // so the diff must too, though plain `git diff` would omit it.
    await writeFile(join(cwd, ".zitadel", "schemas", "new.json"), '{ "added": true }\n');

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).toContain("new.json");
    expect(diff).toContain("added");
  });

  it("still shows a tracked change, leaving files outside .zitadel/ out", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await writeFile(join(cwd, ".zitadel", "schemas", "marker.json"), '{ "edited": true }\n');
    await writeFile(join(cwd, "README.md"), "# app\n\nedited\n");

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).toContain("marker.json");
    expect(diff).not.toContain("README.md");
  });

  it("shows a referenced template the bundle inlines from outside .zitadel/", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await mkdir(join(cwd, "templates"), { recursive: true });
    await writeFile(join(cwd, "templates", "login.liquid"), "<p>edited</p>\n");

    const diff = await diffConfigAgainst(cwd, sha, false, ["templates/login.liquid"]);

    expect(diff).toContain("login.liquid");
    expect(diff).toContain("edited");
  });

  it("leaves a referenced file out when nothing references it", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await mkdir(join(cwd, "templates"), { recursive: true });
    await writeFile(join(cwd, "templates", "login.liquid"), "<p>edited</p>\n");

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).not.toContain("login.liquid");
  });

  it("never shows .zitadel/secret, which is not part of a release", async () => {
    const cwd = await cleanRepo();
    const sha = (await run("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
    await writeFile(join(cwd, ".zitadel", "secret"), '{ "project_secret": "sk_live" }\n');

    const diff = await diffConfigAgainst(cwd, sha, false);

    expect(diff).not.toContain("sk_live");
  });

  it("returns null when the commit is not in this repository's history", async () => {
    const cwd = await cleanRepo();

    expect(await diffConfigAgainst(cwd, "0".repeat(40), false)).toBeNull();
  });
});
