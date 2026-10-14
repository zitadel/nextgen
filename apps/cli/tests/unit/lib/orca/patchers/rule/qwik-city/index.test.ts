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
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
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
    expect(writeContents(plan, "src/routes/profile/index.tsx")).toContain("ZitadelSession");
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain("background:#0f0f11");
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain("@zitadel/sdk-qwik");
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain("ZitadelLogin");
  });

  // The pages render the Qwik 2 @zitadel/sdk-qwik widgets, so they must be on
  // Qwik 2 too; a Qwik 1 (@builder.io/qwik) import would not resolve in the app.
  it.each([
    "src/routes/index.tsx",
    "src/routes/login/index.tsx",
    "src/routes/register/index.tsx",
    "src/routes/profile/index.tsx",
  ])("imports %s's component$ from Qwik 2's @qwik.dev/core", (path) => {
    expect(writeContents(new QwikCityPatcher().plan(ctx()), path)).toContain(
      'import { component$ } from "@qwik.dev/core";',
    );
  });

  it.each([
    "src/routes/plugin@nextgen.ts",
    "src/routes/index.tsx",
    "src/routes/login/index.tsx",
    "src/routes/register/index.tsx",
    "src/routes/profile/index.tsx",
  ])("references no Qwik 1 @builder.io package in %s", (path) => {
    expect(writeContents(new QwikCityPatcher().plan(ctx()), path)).not.toContain("@builder.io");
  });

  it("seeds the public project id and edits no config but the dev script", () => {
    const plan = new QwikCityPatcher().plan(ctx());
    const envOp = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "merge-env" }> =>
        op.kind === "merge-env" &&
        op.path === ".env.local" &&
        "PUBLIC_ZITADEL_PROJECT_ID" in op.entries,
    );
    expect(envOp?.entries).toMatchObject({ PUBLIC_ZITADEL_PROJECT_ID: "proj-1" });
    // baseOps adds AGENTS.md/README.md guidance edits to every plan; beyond
    // those the only config edit is the dev script's port.
    expect(
      plan.ops
        .filter(
          (op): op is Extract<FileOp, { kind: "edit" }> =>
            op.kind === "edit" && !["AGENTS.md", "README.md"].includes(String(op.path)),
        )
        .map((op) => op.path),
    ).toEqual(["package.json"]);
  });

  it("adds both SDKs as devDependencies at the CLI's prerelease tag", () => {
    const deps = new QwikCityPatcher()
      .plan(ctx())
      .ops.filter((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    // Qwik bundles devDependencies into the server build; ecosystem packages go there.
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
    expect(artifacts.configEdits).toEqual(["package.json"]);
  });
});

describe("QwikCityPatcher.canPatch", () => {
  it("matches qwik-city only", () => {
    const patcher = new QwikCityPatcher();
    expect(patcher.canPatch("qwik-city")).toBe(true);
    expect(patcher.canPatch("qwik")).toBe(false);
  });
});

describe("QwikCityPatcher dev server port", () => {
  // Setup registers one origin; a dev server on any other port is refused.
  it("pins the dev script to the registered port, strictly", () => {
    const op = new QwikCityPatcher()
      .plan(ctx())
      .ops.find(
        (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
          candidate.kind === "edit" && candidate.path === "package.json",
      );
    const port = new URL(ctx().issuer).port;

    const pkg = JSON.parse(op!.edit(JSON.stringify({ scripts: { dev: "vite dev" } })));

    expect(pkg.scripts.dev).toBe(`vite dev --port ${port} --strictPort`);
  });
});
