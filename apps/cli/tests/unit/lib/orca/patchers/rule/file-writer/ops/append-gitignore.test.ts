import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { AppendGitignoreOp } from "@/lib/orca/patchers/rule/file-writer/ops/append-gitignore";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

/** A rule whose entry is its path, so the text a test finds is the rule it gave. */
const ENV = { path: ".env", ignored: true, entry: ".env" } as const;

/** A rule met by a file that ignores the directory its path lies in. */
const NODE_MODULES = { path: "node_modules/x", ignored: true, entry: "node_modules" } as const;

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("AppendGitignoreOp", () => {
  it("is about .gitignore in the workspace", async ({ dir }) => {
    const change = await new AppendGitignoreOp({
      kind: "append-gitignore",
      rules: [ENV],
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ path: join(dir, ".gitignore"), next: ".env\n" });
  });

  it("adds only the entries for rules the file breaks", async ({ dir }) => {
    await writeFile(join(dir, ".gitignore"), "node_modules\n");

    const change = await new AppendGitignoreOp({
      kind: "append-gitignore",
      rules: [NODE_MODULES, ENV],
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ next: "node_modules\n.env\n" });
  });

  it("leaves the file as it is when another line already meets every rule", async ({ dir }) => {
    await writeFile(join(dir, ".gitignore"), ".env*\r\n");

    const change = await new AppendGitignoreOp({
      kind: "append-gitignore",
      rules: [ENV],
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: ".env*\r\n", next: ".env*\r\n" });
  });
});
