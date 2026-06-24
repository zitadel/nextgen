import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { QwikCityPatcher } from "../../../../../../../src/lib/orca/patchers/rule/qwik-city";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "src"): PatchContext {
  return {
    framework: { id: "qwik-city", appDir, devPort: 5173, url: "http://localhost:5173" },
    rendererId: "qwik",
    project: {
      id: "proj-1",
      projectSecret: "sk_full",
      previewSecret: "sk_preview",
      previewOrigins: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:5173",
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

describe("QwikCityPatcher.plan", () => {
  it("writes the onRequest plugin and file-based routes under src/", () => {
    const plan = new QwikCityPatcher().plan(ctx());

    expect(writeContents(plan, "src/routes/plugin@nextgen.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/plugin@nextgen.ts")).toContain(
      "@zitadel/sdk-qwik-city/server",
    );
    expect(writeContents(plan, "src/routes/plugin@nextgen.ts")).toContain("createNextgenOnRequest");

    expect(writeContents(plan, "src/routes/index.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain('purpose="login"');
    expect(writeContents(plan, "src/routes/register/index.tsx")).toContain('purpose="register"');
    expect(writeContents(plan, "src/routes/profile/index.tsx")).toContain("ZitadelLogout");
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain("background:#0f0f11");
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain("@zitadel/sdk-qwik");
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain("ZitadelLogin");
  });

  it("seeds the public project id and no other config edit", () => {
    const plan = new QwikCityPatcher().plan(ctx());
    const envOp = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "merge-env" }> =>
        op.kind === "merge-env" &&
        op.path === ".env.local" &&
        "PUBLIC_ZITADEL_PROJECT_ID" in op.entries,
    );
    expect(envOp?.entries).toMatchObject({ PUBLIC_ZITADEL_PROJECT_ID: "proj-1" });
    expect(plan.ops.some((op) => op.kind === "edit")).toBe(false);
  });

  it("adds both SDKs as devDependencies at the CLI's prerelease tag", () => {
    const deps = new QwikCityPatcher()
      .plan(ctx())
      .ops.filter((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    // Qwik City's vite config forces /qwik/i-named packages into devDependencies.
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-qwik-city", version: "alpha", dev: true }),
    );
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-qwik", version: "alpha", dev: true }),
    );
  });
});

describe("QwikCityPatcher.artifacts", () => {
  it("lists the routes + plugin as managed, the SDK as a dependency, no config edits", () => {
    const artifacts = new QwikCityPatcher().artifacts({
      framework: { id: "qwik-city", appDir: "src", devPort: 5173, url: "http://localhost:5173" },
      rendererId: "qwik",
    });
    expect(artifacts.markedFiles).toContain("src/routes/plugin@nextgen.ts");
    expect(artifacts.markedFiles).toContain("src/routes/login/index.tsx");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-qwik-city", "@zitadel/sdk-qwik"]);
    expect(artifacts.configEdits).toEqual([]);
  });
});

describe("QwikCityPatcher.canPatch", () => {
  it("matches qwik-city only", () => {
    const patcher = new QwikCityPatcher();
    expect(patcher.canPatch("qwik-city")).toBe(true);
    expect(patcher.canPatch("qwik")).toBe(false);
  });
});
