import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { EditOp } from "@/lib/orca/patchers/rule/file-writer/ops/edit";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("EditOp", () => {
  it("hands the edit what the file holds, and asks for what it returns", async ({ dir }) => {
    await writeFile(join(dir, "a.ts"), "held");

    const change = await new EditOp({
      kind: "edit",
      path: "a.ts",
      edit: (source) => `${source}+`,
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: "held", next: "held+", atomic: true });
  });

  it("hands the edit undefined when the file is not there", async ({ dir }) => {
    const change = await new EditOp({
      kind: "edit",
      path: "a.ts",
      edit: (source) => String(source),
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: undefined, next: "undefined", mode: undefined });
  });

  it("keeps the mode of the file it edits", async ({ dir }) => {
    await writeFile(join(dir, "a.ts"), "held");
    await chmod(join(dir, "a.ts"), 0o640);

    const change = await new EditOp({ kind: "edit", path: "a.ts", edit: () => "new" }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({ mode: 0o640 });
  });

  it("takes a single path or a list of candidates", async ({ dir }) => {
    await writeFile(join(dir, "b.ts"), "held");

    const single = await new EditOp({ kind: "edit", path: "b.ts", edit: () => "n" }).plan(
      workspaceIn(dir),
    );
    const listed = await new EditOp({ kind: "edit", path: ["a.ts", "b.ts"], edit: () => "n" }).plan(
      workspaceIn(dir),
    );

    expect([single, listed].map((change) => change.kind === "file" && change.path)).toEqual([
      join(dir, "b.ts"),
      join(dir, "b.ts"),
    ]);
  });
});
