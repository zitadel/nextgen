import { describe, expect, it } from "vitest";

import type { FileOp, ScaffoldPlan } from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { NextPatcher } from "../../../../../../../src/lib/orca/patchers/rule/next";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";
import { buildUserSchema } from "../../../../../../../src/lib/user-schema";

function ctxFor(appDir: "app" | "src/app"): PatchContext {
  return {
    framework: { id: "next", appDir, devPort: 3000, issuerUrl: "http://localhost:3000" },
    rendererId: "react",
    project: {
      project_id: "proj-1",
      project_secret: "sk_proj_full",
      preview_secret: "sk_proj_preview",
      preview_origins: [],
      lifecycle: "unclaimed",
      claim_required_for: ["preview", "production"],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:3000",
    userFields: ["email", "given_name"],
    userSchema: buildUserSchema(["email", "given_name"]),
    server: "https://api.zitadel.cloud",
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
    expect(writeContents(plan, ".zitadel/schemas/user.json")).toContain('"x-unique": "project"');
    expect(writeContents(plan, ".zitadel/flows/default.json")).toContain('"name": "default"');
    expect(writeContents(plan, "zitadel.json")).toContain('"project": "proj-1"');
    expect(writeContents(plan, "app/login/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "app/register/page.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "middleware.ts")).toContain(MANAGED_MARKER);
    expect(plan.ops.some((op) => op.kind === "add-dep")).toBe(true);
  });

  it("honors the src/app directory", () => {
    const plan = new NextPatcher().plan(ctxFor("src/app"));
    expect(writeContents(plan, "src/app/login/page.tsx")).toContain(MANAGED_MARKER);
  });

  it("password flow's credential step references the password property", () => {
    const plan = new NextPatcher().plan(ctxFor("app"));
    const flowJson = writeContents(plan, ".zitadel/flows/default.json");
    expect(flowJson).toBeDefined();
    const flow = JSON.parse(flowJson ?? "{}") as {
      steps: ReadonlyArray<{ name: string; fields: ReadonlyArray<string> }>;
    };
    const credential = flow.steps.find((step) => step.name === "credential");
    expect(credential?.fields).toEqual(["password"]);
  });
});

describe("NextPatcher.artifacts", () => {
  it("lists managed files, the config file, the dir, and the env backup", () => {
    const artifacts = new NextPatcher().artifacts({
      framework: { id: "next", appDir: "app", devPort: 3000, issuerUrl: "http://localhost:3000" },
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
    expect(artifacts.dependencies).toEqual(["@zitadel-nextgen/sdk-next"]);
  });
});
