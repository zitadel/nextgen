import { describe, expect, it } from "vitest";

import type { ScaffoldPlan } from "../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { reclaimableOps } from "../../../../../../src/lib/orca/patchers/rule/reclaim";
import { MANAGED_MARKER } from "../../../../../../src/lib/paths";

const plan: ScaffoldPlan = {
  ops: [
    { kind: "mkdir", path: ".zitadel" },
    { kind: "write", path: ".zitadel/secret", contents: "{}" },
    { kind: "write", path: "zitadel.json", contents: "{}" },
    { kind: "write", path: "app/login/page.tsx", contents: `${MANAGED_MARKER}\nexport {}` },
    { kind: "append-gitignore", entries: [".env*"] },
    { kind: "merge-env", path: ".env.local", entries: { A: "1" } },
    { kind: "add-dep", name: "pkg", version: "1.0.0" },
    { kind: "edit", path: "vite.config.ts", edit: (source) => source ?? "" },
  ],
  summary: [],
};

describe("reclaimableOps", () => {
  it("keeps env, gitignore, add-dep, edit, and marker-bearing writes", () => {
    const kinds = reclaimableOps(plan).map((op) => op.kind);
    expect(kinds).toEqual(["write", "append-gitignore", "merge-env", "add-dep", "edit"]);
  });

  it("keeps config edits so doctor --fix can restore a removed proxy", () => {
    const ops = reclaimableOps(plan);
    expect(ops.some((op) => op.kind === "edit" && op.path === "vite.config.ts")).toBe(true);
  });

  it("keeps the managed page write but drops unmarked .zitadel/config writes", () => {
    const ops = reclaimableOps(plan);
    expect(ops.some((op) => op.kind === "write" && op.path === "app/login/page.tsx")).toBe(true);
    expect(ops.some((op) => op.kind === "write" && op.path === ".zitadel/secret")).toBe(false);
    expect(ops.some((op) => op.kind === "write" && op.path === "zitadel.json")).toBe(false);
    expect(ops.some((op) => op.kind === "mkdir")).toBe(false);
  });
});
