import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { QwikRouterPatcher } from "../../../../../../../src/lib/orca/patchers/rule/qwik-router";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "src", scaffoldedFramework = true): PatchContext {
  return {
    framework: { id: "qwik-router", appDir, devPort: 5173, url: "http://localhost:5173" },
    rendererId: "qwik",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
    },
    issuer: "http://localhost:5173",
    server: "https://api.zitadel.cloud",
    cliVersion: "0.1.0-alpha.0",
    scaffoldedFramework,
  };
}

function writeContents(plan: ScaffoldPlan, path: string): string | undefined {
  const op = plan.ops.find(
    (candidate): candidate is Extract<FileOp, { kind: "write" }> =>
      candidate.kind === "write" && candidate.path === path,
  );
  return op?.contents;
}

describe("QwikRouterPatcher.plan", () => {
  it("writes the onRequest plugin and file-based routes under src/", () => {
    const plan = new QwikRouterPatcher().plan(ctx());

    expect(writeContents(plan, "src/routes/plugin@nextgen.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/plugin@nextgen.ts")).toContain(
      "@zitadel/sdk-qwik-router/server",
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

  it("keeps a pre-existing app's landing page, writing the rest (ADR 044)", () => {
    const plan = new QwikRouterPatcher().plan(ctx("src", false));

    // The user's own landing page is left untouched, so setup never conflicts
    // on it or overwrites it under --force.
    expect(writeContents(plan, "src/routes/index.tsx")).toBeUndefined();
    // The auth boundary and the auth routes are still written.
    expect(writeContents(plan, "src/routes/plugin@nextgen.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login/index.tsx")).toContain('purpose="login"');
    expect(writeContents(plan, "src/routes/register/index.tsx")).toContain('purpose="register"');
    expect(writeContents(plan, "src/routes/profile/index.tsx")).toContain("ZitadelSession");
  });

  // The pages render the Qwik 2 @zitadel/sdk-qwik widgets, so they must be on
  // Qwik 2 too; a Qwik 1 (@builder.io/qwik) import would not resolve in the app.
  it.each([
    "src/routes/index.tsx",
    "src/routes/login/index.tsx",
    "src/routes/register/index.tsx",
    "src/routes/profile/index.tsx",
  ])("imports %s's component$ from Qwik 2's @qwik.dev/core", (path) => {
    expect(writeContents(new QwikRouterPatcher().plan(ctx()), path)).toContain(
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
    expect(writeContents(new QwikRouterPatcher().plan(ctx()), path)).not.toContain("@builder.io");
  });

  it("seeds the public project id and edits no config but the dev script", () => {
    const plan = new QwikRouterPatcher().plan(ctx());
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

  it("adds both SDKs as devDependencies at the CLI's exact version", () => {
    const deps = new QwikRouterPatcher()
      .plan(ctx())
      .ops.filter((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    // Qwik bundles devDependencies into the server build; ecosystem packages go there.
    expect(deps).toContainEqual(
      expect.objectContaining({
        name: "@zitadel/sdk-qwik-router",
        version: "0.1.0-alpha.0",
        dev: true,
      }),
    );
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-qwik", version: "0.1.0-alpha.0", dev: true }),
    );
  });

  const businessPages = ["src/routes/login/index.tsx", "src/routes/register/index.tsx"];

  // Minimal and consumer scaffolds keep the widget's neutral built-in copy.
  it.each(businessPages)("keeps the neutral copy in %s by default", (path) => {
    expect(writeContents(new QwikRouterPatcher().plan(ctx()), path)).not.toContain(
      "businessLocales",
    );
  });

  it.each(businessPages)("keeps the neutral copy in %s for consumer projects", (path) => {
    expect(
      writeContents(new QwikRouterPatcher().plan({ ...ctx(), useCase: "consumer" }), path),
    ).not.toContain("businessLocales");
  });

  it.each(businessPages)(
    "imports the business copy overlay in %s for business projects",
    (path) => {
      expect(
        writeContents(new QwikRouterPatcher().plan({ ...ctx(), useCase: "business" }), path),
      ).toContain(
        'import { ZitadelLogin, businessLocales, configureZitadel } from "@zitadel/sdk-qwik";',
      );
    },
  );

  it.each(businessPages)("passes the business copy overlay in %s for business projects", (path) => {
    expect(
      writeContents(new QwikRouterPatcher().plan({ ...ctx(), useCase: "business" }), path),
    ).toContain("locales={businessLocales}");
  });
});

describe("QwikRouterPatcher.artifacts", () => {
  it("lists the routes + plugin as managed, the SDK as a dependency, no config edits", () => {
    const artifacts = new QwikRouterPatcher().artifacts({
      framework: { id: "qwik-router", appDir: "src", devPort: 5173, url: "http://localhost:5173" },
      rendererId: "qwik",
    });
    expect(artifacts.markedFiles).toContain("src/routes/plugin@nextgen.ts");
    expect(artifacts.markedFiles).toContain("src/routes/login/index.tsx");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-qwik-router", "@zitadel/sdk-qwik"]);
    expect(artifacts.configEdits).toEqual(["package.json"]);
  });

  it("declares the landing page as conditionally scaffolded", () => {
    // Written only on fresh scaffolds, so the managed-files check must not
    // expect it on a manifest-less pre-existing app.
    const artifacts = new QwikRouterPatcher().artifacts({
      framework: { id: "qwik-router", appDir: "src", devPort: 5173, url: "http://localhost:5173" },
      rendererId: "qwik",
    });
    expect(artifacts.conditionalFiles).toEqual(expect.arrayContaining(["src/routes/index.tsx"]));
  });
});

describe("QwikRouterPatcher.canPatch", () => {
  it("matches qwik-router only", () => {
    const patcher = new QwikRouterPatcher();
    expect(patcher.canPatch("qwik-router")).toBe(true);
    expect(patcher.canPatch("qwik")).toBe(false);
  });
});

describe("QwikRouterPatcher dev server port", () => {
  // Setup registers one origin; a dev server on any other port is refused.
  it("pins the dev script to the registered port, strictly", () => {
    const op = new QwikRouterPatcher()
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
