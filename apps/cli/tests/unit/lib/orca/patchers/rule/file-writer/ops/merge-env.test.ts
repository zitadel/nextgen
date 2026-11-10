import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { MergeEnvOp } from "@/lib/orca/patchers/rule/file-writer/ops/merge-env";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("MergeEnvOp", () => {
  it("adds the entries the file does not hold, under the comment once", async ({ dir }) => {
    const op = new MergeEnvOp({
      kind: "merge-env",
      path: ".env",
      entries: { A: "1" },
      comment: ["Set by Zitadel."],
    });

    const change = await op.plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: undefined, next: "# Set by Zitadel.\nA=1\n" });
  });

  it("does not repeat the comment when the file already carries it", async ({ dir }) => {
    await writeFile(join(dir, ".env"), "# Set by Zitadel.\nA=1\n");

    const change = await new MergeEnvOp({
      kind: "merge-env",
      path: ".env",
      entries: { A: "1", B: "2" },
      comment: ["Set by Zitadel."],
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ next: "# Set by Zitadel.\nA=1\nB=2\n" });
  });

  it("keeps the value the file holds, unless the op overwrites", async ({ dir }) => {
    await writeFile(join(dir, ".env"), "A=old\n");

    const kept = await new MergeEnvOp({
      kind: "merge-env",
      path: ".env",
      entries: { A: "new" },
    }).plan(workspaceIn(dir));
    const replaced = await new MergeEnvOp({
      kind: "merge-env",
      path: ".env",
      entries: { A: "new" },
      overwrite: true,
    }).plan(workspaceIn(dir));

    expect([kept, replaced].map((change) => change.kind === "file" && change.next)).toEqual([
      "A=old\n",
      "A=new\n",
    ]);
  });

  it("asks for the file's mode to be put back on every run", async ({ dir }) => {
    const change = await new MergeEnvOp({
      kind: "merge-env",
      path: ".env",
      entries: { A: "1" },
      mode: 0o600,
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ mode: 0o600, reassertMode: true });
  });

  it("does not quote a line it leaves alone, so an entry the file already holds cannot refuse the run", async ({
    dir,
  }) => {
    await writeFile(join(dir, ".env"), "A=1\n");

    const change = await new MergeEnvOp({
      kind: "merge-env",
      path: ".env",
      entries: { A: "x\ny" },
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: "A=1\n", next: "A=1\n" });
  });

  it("matches a line to an entry only by its own key, never by an inherited one", async ({
    dir,
  }) => {
    await writeFile(join(dir, ".env"), "constructor=1\n");

    const change = await new MergeEnvOp({
      kind: "merge-env",
      path: ".env",
      entries: { A: "1" },
      overwrite: true,
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ next: "constructor=1\nA=1\n" });
  });
});
