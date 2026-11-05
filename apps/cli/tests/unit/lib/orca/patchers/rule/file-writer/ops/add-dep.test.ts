import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect } from "vitest";

import { it } from "@tests/helpers/fixtures";
import { rejectionOf } from "@tests/helpers/thrown-value";

import { AddDepOp } from "@/lib/orca/patchers/rule/file-writer/ops/add-dep";
import { Workspace } from "@/lib/orca/patchers/rule/file-writer/workspace";

function workspaceIn(cwd: string) {
  return new Workspace({ cwd, dryRun: false, force: false });
}

async function nextOf(
  dir: string,
  manifest: object,
  op: { name: string; version: string; dev?: boolean },
) {
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest, null, 2));
  const change = await new AddDepOp({ kind: "add-dep", ...op }).plan(workspaceIn(dir));

  return change.kind === "file" ? JSON.parse(change.next) : undefined;
}

describe("AddDepOp", () => {
  it("refuses to add to a package.json that is not there", async ({ dir }) => {
    const error = await rejectionOf(() =>
      new AddDepOp({ kind: "add-dep", name: "a", version: "^1" }).plan(workspaceIn(dir)),
    );

    expect(error).toMatchObject({ code: "E_VALIDATION" });
  });

  it("adds the dependency, and names it for the report", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), "{}");

    const change = await new AddDepOp({ kind: "add-dep", name: "a", version: "^1" }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({ dependency: "a" });
    expect(change.kind === "file" && JSON.parse(change.next)).toEqual({
      dependencies: { a: "^1" },
    });
  });

  it("keeps the dependencies sorted by name", async ({ dir }) => {
    const next = await nextOf(
      dir,
      { dependencies: { z: "1", b: "1" } },
      { name: "m", version: "1" },
    );

    expect(Object.keys(next.dependencies)).toEqual(["b", "m", "z"]);
  });

  it("adds a dev dependency to devDependencies", async ({ dir }) => {
    const next = await nextOf(dir, {}, { name: "t", version: "1", dev: true });

    expect(next).toEqual({ devDependencies: { t: "1" } });
  });

  it("leaves the file as it is when the dependency is already at that version", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), '{"dependencies":{"a":"^1"}}');

    const change = await new AddDepOp({ kind: "add-dep", name: "a", version: "^1" }).plan(
      workspaceIn(dir),
    );

    expect(change).toMatchObject({
      before: '{"dependencies":{"a":"^1"}}',
      next: '{"dependencies":{"a":"^1"}}',
    });
  });

  it("changes the version of a dependency that is at another one", async ({ dir }) => {
    const next = await nextOf(dir, { dependencies: { a: "^1" } }, { name: "a", version: "^2" });

    expect(next.dependencies.a).toBe("^2");
  });

  it("never demotes a runtime dependency to a dev one", async ({ dir }) => {
    await writeFile(join(dir, "package.json"), '{"dependencies":{"a":"^1"}}');

    const change = await new AddDepOp({
      kind: "add-dep",
      name: "a",
      version: "^2",
      dev: true,
    }).plan(workspaceIn(dir));

    expect(change).toMatchObject({ next: '{"dependencies":{"a":"^1"}}' });
  });

  it("moves a dev dependency the developer has into dependencies", async ({ dir }) => {
    const next = await nextOf(
      dir,
      { devDependencies: { a: "^1", b: "^1" } },
      { name: "a", version: "^2" },
    );

    expect(next).toEqual({ dependencies: { a: "^2" }, devDependencies: { b: "^1" } });
  });

  it("leaves peer and optional dependencies alone", async ({ dir }) => {
    const next = await nextOf(dir, { peerDependencies: { a: "^1" } }, { name: "a", version: "^2" });

    expect(next).toEqual({ peerDependencies: { a: "^1" }, dependencies: { a: "^2" } });
  });
});
