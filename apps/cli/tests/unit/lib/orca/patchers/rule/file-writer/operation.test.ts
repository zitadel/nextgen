import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { EditOp } from "@/lib/orca/patchers/rule/file-writer/ops/edit";
import { MkdirOp } from "@/lib/orca/patchers/rule/file-writer/ops/mkdir";
import { WriteOp } from "@/lib/orca/patchers/rule/file-writer/ops/write";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("Operation", () => {
  it("acts on the first candidate that exists", async ({ dir }) => {
    await writeFile(join(dir, "b.ts"), "held");

    const change = await new EditOp({
      kind: "edit",
      path: ["a.ts", "b.ts"],
      edit: (source) => `${source}!`,
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({
      kind: "file",
      path: join(dir, "b.ts"),
      before: "held",
      next: "held!",
    });
  });

  it("acts on the first candidate when none exists", async ({ dir }) => {
    const change = await new EditOp({
      kind: "edit",
      path: ["a.ts", "b.ts"],
      edit: () => "new",
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ path: join(dir, "a.ts"), before: undefined });
  });

  it("refuses an op that names no path", async ({ dir }) => {
    const error = await rejectionOf(() =>
      new EditOp({ kind: "edit", path: [], edit: () => "" }).plan(workspaceIn(dir)),
    );

    expect(error).toMatchObject({ code: "E_VALIDATION" });
  });

  it("refuses a directory where a file is needed, before the op looks at it", async ({ dir }) => {
    await mkdir(join(dir, "x"));
    const seen: Array<string | undefined> = [];

    const error = await rejectionOf(() =>
      new EditOp({
        kind: "edit",
        path: "x",
        edit: (source) => {
          seen.push(source);
          return "";
        },
      }).plan(workspaceIn(dir)),
    );

    expect(error).toMatchObject({
      code: "E_VALIDATION",
      message: expect.stringContaining("not a regular file"),
    });
    expect(seen).toEqual([]);
  });

  it("refuses a directory for every op that writes a file", async ({ dir }) => {
    await mkdir(join(dir, "x"));

    const error = await rejectionOf(() =>
      new WriteOp({ kind: "write", path: "x", contents: "c" }).plan(workspaceIn(dir)),
    );

    expect(error).toMatchObject({ code: "E_VALIDATION" });
  });

  it("lets a directory op act on a directory", async ({ dir }) => {
    await mkdir(join(dir, "d"));

    const change = await new MkdirOp({ kind: "mkdir", path: "d" }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ kind: "dir", isExisting: true });
  });

  it.skipIf(process.platform === "win32")(
    "never reads the path a directory op acts on",
    async ({ dir }) => {
      execFileSync("mkfifo", [join(dir, "pipe")]);

      const change = await new MkdirOp({ kind: "mkdir", path: "pipe" }).plan(workspaceIn(dir));

      expect(change).toMatchObject({ kind: "dir", isExisting: false });
    },
  );

  it("is frozen", () => {
    expect(Object.isFrozen(new MkdirOp({ kind: "mkdir", path: "d" }))).toBe(true);
  });
});
