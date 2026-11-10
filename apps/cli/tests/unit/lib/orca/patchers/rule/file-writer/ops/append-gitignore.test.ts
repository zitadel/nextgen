import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { AppendGitignoreOp } from "@/lib/orca/patchers/rule/file-writer/ops/append-gitignore";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("AppendGitignoreOp", () => {
  it("is about .gitignore in the workspace", async ({ dir }) => {
    const change = await new AppendGitignoreOp({
      kind: "append-gitignore",
      entries: [".env"],
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ path: join(dir, ".gitignore"), next: ".env\n" });
  });

  it("adds only the entries it does not hold", async ({ dir }) => {
    await writeFile(join(dir, ".gitignore"), "node_modules\n");

    const change = await new AppendGitignoreOp({
      kind: "append-gitignore",
      entries: ["node_modules", ".env"],
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ next: "node_modules\n.env\n" });
  });

  it("leaves the file as it is when it holds them all, line endings and padding aside", async ({
    dir,
  }) => {
    await writeFile(join(dir, ".gitignore"), " .env \r\n");

    const change = await new AppendGitignoreOp({
      kind: "append-gitignore",
      entries: [".env"],
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: " .env \r\n", next: " .env \r\n" });
  });
});
