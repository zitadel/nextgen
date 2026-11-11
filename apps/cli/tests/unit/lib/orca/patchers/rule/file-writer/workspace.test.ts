import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string, options: { dryRun?: boolean; force?: boolean } = {}) {
  return new Workspace({ cwd, dryRun: options.dryRun ?? false, force: options.force ?? false });
}

describe("Workspace", () => {
  it("resolves a plan path against its directory", ({ dir }) => {
    expect(workspaceIn(dir).resolve("a/b")).toBe(join(dir, "a/b"));
  });

  it("reads a file, and answers undefined for one that does not exist", async ({ dir }) => {
    await writeFile(join(dir, "x"), "held");

    expect(await workspaceIn(dir).read(join(dir, "x"))).toBe("held");
    expect(await workspaceIn(dir).read(join(dir, "missing"))).toBeUndefined();
  });

  it("tells a file from a directory and reports its permission bits", async ({ dir }) => {
    await writeFile(join(dir, "f"), "x", { mode: 0o640 });
    await chmod(join(dir, "f"), 0o640);
    await mkdir(join(dir, "d"));

    const workspace = workspaceIn(dir);

    expect(await workspace.inspect(join(dir, "f"))).toMatchObject({
      isFile: true,
      isDirectory: false,
      mode: 0o640,
    });
    expect(await workspace.inspect(join(dir, "d"))).toMatchObject({
      isFile: false,
      isDirectory: true,
    });
  });

  it("answers undefined only for a path that is not there", async ({ dir }) => {
    await writeFile(join(dir, "f"), "x");

    expect(await workspaceIn(dir).inspect(join(dir, "missing"))).toBeUndefined();
    expect(
      await rejectionOf(() => workspaceIn(dir).inspect(join(dir, "f", "below"))),
    ).toMatchObject({
      code: "ENOTDIR",
    });
  });

  it("locates the first candidate that exists, in order", async ({ dir }) => {
    await writeFile(join(dir, "second"), "x");
    await writeFile(join(dir, "third"), "x");

    const located = await workspaceIn(dir).locate([
      join(dir, "first"),
      join(dir, "second"),
      join(dir, "third"),
    ]);

    expect(located?.path).toBe(join(dir, "second"));
  });

  it("locates nothing when no candidate exists, or there are none", async ({ dir }) => {
    expect(await workspaceIn(dir).locate([join(dir, "a"), join(dir, "b")])).toBeUndefined();
    expect(await workspaceIn(dir).locate([])).toBeUndefined();
  });

  it("creates a file with its parent directories and reports it", async ({ dir }) => {
    const path = join(dir, "a/b/c");

    const outcome = await workspaceIn(dir).commit({
      kind: "file",
      path,
      before: undefined,
      next: "n",
    });

    expect(outcome).toEqual({ path, kind: "file", action: "create", dependency: undefined });
    expect(await readFile(path, "utf8")).toBe("n");
  });

  it("skips a file that already holds what it should, and reports no dependency", async ({
    dir,
  }) => {
    const path = join(dir, "x");
    await writeFile(path, "same");

    const outcome = await workspaceIn(dir).commit({
      kind: "file",
      path,
      before: "same",
      next: "same",
      dependency: "left-pad",
    });

    expect(outcome).toEqual({ path, kind: "file", action: "skip", dependency: undefined });
  });

  it("reports a dependency when the change is made, and on a dry run", async ({ dir }) => {
    const change = {
      kind: "file",
      path: join(dir, "p"),
      before: "old",
      next: "new",
      dependency: "d",
    } as const;

    expect((await workspaceIn(dir, { dryRun: true }).commit(change)).dependency).toBe("d");
  });

  it("touches nothing on a dry run, and still says what would happen", async ({ dir }) => {
    const path = join(dir, "x");

    const outcome = await workspaceIn(dir, { dryRun: true }).commit({
      kind: "file",
      path,
      before: undefined,
      next: "n",
    });

    expect(outcome.action).toBe("create");
    expect(await readdir(dir)).toEqual([]);
  });

  it("writes atomically without leaving a temporary file behind", async ({ dir }) => {
    const path = join(dir, "x");

    await workspaceIn(dir).commit({
      kind: "file",
      path,
      before: undefined,
      next: "n",
      atomic: true,
    });

    expect(await readdir(dir)).toEqual(["x"]);
  });

  it("sets the mode of what it writes", async ({ dir }) => {
    const path = join(dir, "secret");

    await workspaceIn(dir).commit({
      kind: "file",
      path,
      before: undefined,
      next: "n",
      mode: 0o600,
    });

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("brings an unchanged secret back to its mode only when asked to", async ({ dir }) => {
    const path = join(dir, "secret");
    await writeFile(path, "same");
    await chmod(path, 0o644);

    await workspaceIn(dir).commit({
      kind: "file",
      path,
      before: "same",
      next: "same",
      mode: 0o600,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o644);

    await workspaceIn(dir).commit({
      kind: "file",
      path,
      before: "same",
      next: "same",
      mode: 0o600,
      reassertMode: true,
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("makes a directory, repairs its mode, and skips one that is as it should be", async ({
    dir,
  }) => {
    const path = join(dir, "vault");
    const workspace = workspaceIn(dir);

    const made = await workspace.commit({
      kind: "dir",
      path,
      mode: 0o700,
      isExisting: false,
      isDrifted: false,
    });
    const repaired = await workspace.commit({
      kind: "dir",
      path,
      mode: 0o700,
      isExisting: true,
      isDrifted: true,
    });
    const settled = await workspace.commit({
      kind: "dir",
      path,
      mode: 0o700,
      isExisting: true,
      isDrifted: false,
    });

    expect([made.action, repaired.action, settled.action]).toEqual(["create", "update", "skip"]);
    expect((await stat(path)).mode & 0o777).toBe(0o700);
  });

  it("is frozen", ({ dir }) => {
    expect(Object.isFrozen(workspaceIn(dir))).toBe(true);
  });
});
