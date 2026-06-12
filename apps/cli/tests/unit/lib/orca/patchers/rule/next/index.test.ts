import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { NextPatcher } from "../../../../../../../src/lib/orca/patchers/rule/next";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctxFor(appDir: "app" | "src/app"): PatchContext {
  return {
    framework: { id: "next", appDir, devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      projectSecret: "sk_proj_full",
      previewSecret: "sk_proj_preview",
      previewOrigins: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
  };
}

function writeContents(plan: ScaffoldPlan, path: string): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  return op?.contents;
}

describe("NextPatcher.plan", () => {
  it("emits the base .zitadel files and Next routes for the app dir", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    expect(writeContents(plan, "zitadel.json")).toContain('"project": "proj-1"');
    expect(writeContents(plan, "app/login/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/register/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "middleware.ts")).toContain(MANAGED_MARKER);
    expect(plan.ops.some((op) => op.kind === "add-dep")).toBe(true);
  });

  it("uses the CLI prerelease tag for the SDK dependency", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    const dep = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep",
    );
    expect(dep).toMatchObject({ name: "@zitadel/sdk-next", version: "alpha" });
  });

  it("does not scaffold the user schema or flow (server-provisioned)", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    expect(writeContents(plan, ".zitadel/schemas/user.json")).toBeUndefined();
    expect(writeContents(plan, ".zitadel/flows/default.json")).toBeUndefined();
  });

  it("writes preview issuer_pattern as the raw origins, not a doubled scheme", () => {
    const base = ctxFor("app");
    const ctx = {
      ...base,
      project: { ...base.project, previewOrigins: ["https://nextgen.dev.mrida.ng"] },
    };
    const zitadelJson = JSON.parse(
      writeContents(new NextPatcher().plan(ctx), "zitadel.json") ?? "{}",
    );
    expect(zitadelJson.environments.preview.issuer_pattern).toEqual([
      "https://nextgen.dev.mrida.ng",
    ]);
  });

  it("honors the src/app directory", () => {
    const plan = new NextPatcher().plan(ctxFor("src/app"));
    expect(writeContents(plan, "src/app/login/page.tsx")).toContain(MANAGED_MARKER);
  });
});

describe("NextPatcher.artifacts", () => {
  it("lists managed files, the config file, the dir, and the env backup", () => {
    const artifacts = new NextPatcher().artifacts({
      framework: { id: "next", appDir: "app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toEqual([
      "app/login/page.tsx",
      "app/register/page.tsx",
      "app/profile/page.tsx",
      "middleware.ts",
      "custom-elements.d.ts",
    ]);
    expect(artifacts.rootConfigFiles).toEqual(["zitadel.json"]);
    expect(artifacts.directories).toEqual([".zitadel"]);
    expect(artifacts.envBackups).toEqual([".env.local"]);
    // The react renderer's SDK package — `eject` surfaces this as
    // `npm uninstall <name>` in next_commands.
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-next"]);
  });
});
