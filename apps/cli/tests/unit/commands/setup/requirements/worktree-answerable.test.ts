import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { worktreeAnswerable } from "../../../../../src/commands/setup/requirements/worktree-answerable";
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

describe("worktreeAnswerable", () => {
  it("finds nothing wrong with a directory that is not a repository", async () => {
    const cwd = await directory();

    await expect(worktreeAnswerable.resolve(requirementContext({ meta: { cwd } }))).resolves.toBe(
      true,
    );
  });

  it("finds nothing wrong with a clean repository", async () => {
    const cwd = await repository();

    await expect(worktreeAnswerable.resolve(requirementContext({ meta: { cwd } }))).resolves.toBe(
      true,
    );
  });

  it("leaves version control alone under --no-git", async () => {
    const cwd = await repository();
    await writeFile(join(cwd, "notes.md"), "mine\n");

    await expect(
      worktreeAnswerable.resolve(requirementContext({ flags: { git: false }, meta: { cwd } })),
    ).resolves.toBe(true);
  });

  it("finds nothing wrong where git can answer", async () => {
    const cwd = await repository();
    git(cwd, "checkout", "--quiet", "-b", "other");

    await expect(worktreeAnswerable.resolve(requirementContext({ meta: { cwd } }))).resolves.toBe(
      true,
    );
  });

  it("refuses with a conflict", () => {
    expect(worktreeAnswerable.refusal).toMatchObject({
      code: "E_CONFLICT",
      message: "Could not tell whether the git working tree is clean: {reason}",
    });
  });
});
