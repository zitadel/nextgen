import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";

import { MkdirOp } from "@/lib/orca/patchers/rule/file-writer/ops/mkdir";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

describe("MkdirOp", () => {
  it("asks for a directory that is not there", async ({ dir }) => {
    const change = await new MkdirOp({ kind: "mkdir", path: "d", mode: 0o700 }).plan(
      workspaceIn(dir),
    );

    expect(change).toEqual({
      kind: "dir",
      path: join(dir, "d"),
      mode: 0o700,
      isExisting: false,
      isDrifted: false,
    });
  });

  it("finds a directory that is already there", async ({ dir }) => {
    await mkdir(join(dir, "d"));
    await chmod(join(dir, "d"), 0o700);

    const change = await new MkdirOp({ kind: "mkdir", path: "d", mode: 0o700 }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({ isExisting: true, isDrifted: false });
  });

  it.skipIf(process.platform === "win32")(
    "finds a directory whose permissions have drifted",
    async ({ dir }) => {
      await mkdir(join(dir, "d"));
      await chmod(join(dir, "d"), 0o755);

      const change = await new MkdirOp({ kind: "mkdir", path: "d", mode: 0o700 }).plan(
        workspaceIn(dir),
      );

      expect(change).toMatchObject({ isExisting: true, isDrifted: true });
    },
  );

  it("does not call a directory drifted when no mode is asked for", async ({ dir }) => {
    await mkdir(join(dir, "d"));

    const change = await new MkdirOp({ kind: "mkdir", path: "d" }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ isExisting: true, isDrifted: false });
  });
});
