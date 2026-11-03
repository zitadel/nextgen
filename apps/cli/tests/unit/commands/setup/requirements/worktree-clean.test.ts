import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { worktreeClean } from "../../../../../src/commands/setup/requirements/worktree-clean";
import { requirementContext } from "../../../../helpers/requirement-context";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    await rm(dirs.pop() as string, { recursive: true, force: true });
  }
});

async function directory(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "zitadel-setup-requirement-"));
  dirs.push(cwd);
  return cwd;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore" });
}

async function repository(): Promise<string> {
  const cwd = await directory();
  git(cwd, "init", "--quiet", "--initial-branch=main");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "user.name", "Test");
  await writeFile(join(cwd, "app.txt"), "one\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "--quiet", "-m", "first");
  return cwd;
}

describe("worktreeClean", () => {
  it("finds nothing wrong with a directory that is not a repository", async () => {
    const cwd = await directory();

    await expect(worktreeClean.resolve(requirementContext({ meta: { cwd } }))).resolves.toBe(true);
  });

  it("finds nothing wrong with a clean repository", async () => {
    const cwd = await repository();

    await expect(worktreeClean.resolve(requirementContext({ meta: { cwd } }))).resolves.toBe(true);
  });

  it("leaves version control alone under --no-git", async () => {
    const cwd = await repository();
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(
      worktreeClean.resolve(requirementContext({ flags: { git: false }, meta: { cwd } })),
    ).resolves.toBe(true);
  });

  it("hands the refusal what is uncommitted", async () => {
    const cwd = await repository();
    await writeFile(join(cwd, "notes.md"), "mine\n");
    await writeFile(join(cwd, "app.txt"), "changed\n");

    await expect(worktreeClean.resolve(requirementContext({ meta: { cwd } }))).resolves.toEqual({
      unmet: {
        parts: "1 uncommitted change and 1 untracked file",
        modified: ["app.txt"],
        untracked: ["notes.md"],
      },
    });
  });

  it("refuses with a conflict", () => {
    expect(worktreeClean.refusal).toMatchObject({
      code: "E_CONFLICT",
      message: "The git working tree has {parts}",
    });
  });
});
