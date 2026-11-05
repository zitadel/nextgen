import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { MergeJsonOp } from "@/lib/orca/patchers/rule/file-writer/ops/merge-json";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("MergeJsonOp", () => {
  it("creates the file from the patch when there is none", async ({ dir }) => {
    const change = await new MergeJsonOp({
      kind: "merge-json",
      path: "z.json",
      patch: { a: 1 },
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ before: undefined, next: '{\n  "a": 1\n}\n' });
  });

  it("merges objects found at the same key and replaces everything else", async ({ dir }) => {
    await writeFile(
      join(dir, "z.json"),
      JSON.stringify({ a: { b: 1, c: 2 }, list: [1, 2], keep: true }),
    );

    const change = await new MergeJsonOp({
      kind: "merge-json",
      path: "z.json",
      patch: { a: { c: 3, d: 4 }, list: [9] },
    }).plan(workspaceIn(dir));

    expect(change.kind === "file" && JSON.parse(change.next)).toEqual({
      a: { b: 1, c: 3, d: 4 },
      list: [9],
      keep: true,
    });
  });

  it("refuses a file that is not a JSON object", async ({ dir }) => {
    await writeFile(join(dir, "z.json"), "[1]");

    const error = await rejectionOf(() =>
      new MergeJsonOp({ kind: "merge-json", path: "z.json", patch: {} }).plan(workspaceIn(dir)),
    );

    expect(error).toMatchObject({ message: expect.stringContaining("must contain a JSON object") });
  });
});
