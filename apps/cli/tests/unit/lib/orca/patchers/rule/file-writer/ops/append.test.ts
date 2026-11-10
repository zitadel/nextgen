import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { AppendOp } from "@/lib/orca/patchers/rule/file-writer/ops/append";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("AppendOp", () => {
  it("creates the file from the contents when there is none", async ({ dir }) => {
    const change = await new AppendOp({ kind: "append", path: "a", contents: "c\n" }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({ before: undefined, next: "c\n" });
  });

  it("starts the contents on a line of their own", async ({ dir }) => {
    await writeFile(join(dir, "a"), "held");

    const change = await new AppendOp({ kind: "append", path: "a", contents: "c\n" }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({ next: "held\nc\n" });
  });

  it("adds nothing when the file already holds the marker", async ({ dir }) => {
    await writeFile(join(dir, "a"), "held # zitadel\n");

    const change = await new AppendOp({
      kind: "append",
      path: "a",
      contents: "c\n",
      ifMissing: "# zitadel",
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: "held # zitadel\n", next: "held # zitadel\n" });
  });

  it("treats an empty marker as no marker", async ({ dir }) => {
    await writeFile(join(dir, "a"), "held\n");

    const change = await new AppendOp({
      kind: "append",
      path: "a",
      contents: "c\n",
      ifMissing: "",
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ next: "held\nc\n" });
  });
});
