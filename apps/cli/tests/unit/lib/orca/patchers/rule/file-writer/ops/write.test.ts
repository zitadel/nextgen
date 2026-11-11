import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { WriteOp } from "@/lib/orca/patchers/rule/file-writer/ops/write";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string, force = false) {
  return new Workspace({ cwd, dryRun: false, force });
}

describe("WriteOp", () => {
  it("asks for the file whole, written atomically with its mode", async ({ dir }) => {
    const change = await new WriteOp({
      kind: "write",
      path: "a.txt",
      contents: "c",
      mode: 0o600,
    }).plan(workspaceIn(dir));

    expect(change).toEqual({
      kind: "file",
      path: join(dir, "a.txt"),
      before: undefined,
      next: "c",
      mode: 0o600,
      atomic: true,
    });
  });

  it("refuses to replace a file that holds something else", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "theirs");

    const error = await rejectionOf(() =>
      new WriteOp({ kind: "write", path: "a.txt", contents: "c" }).plan(workspaceIn(dir)),
    );

    expect(error).toMatchObject({ code: "E_CONFLICT", details: { path: join(dir, "a.txt") } });
  });

  it("replaces it when forced", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "theirs");

    const change = await new WriteOp({ kind: "write", path: "a.txt", contents: "c" }).plan(
      workspaceIn(dir, true),
    );

    expect(change).toMatchObject({ before: "theirs", next: "c" });
  });

  it("does not call a file that already holds the contents a conflict", async ({ dir }) => {
    await writeFile(join(dir, "a.txt"), "c");

    const change = await new WriteOp({ kind: "write", path: "a.txt", contents: "c" }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({ before: "c", next: "c" });
  });

  it("writes into a directory that does not exist yet", async ({ dir }) => {
    await mkdir(join(dir, "sub"));

    const change = await new WriteOp({ kind: "write", path: "sub/a.txt", contents: "c" }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({ path: join(dir, "sub/a.txt") });
  });
});
