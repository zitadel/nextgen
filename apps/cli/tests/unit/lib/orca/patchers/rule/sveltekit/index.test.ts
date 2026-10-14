import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { SvelteKitPatcher } from "../../../../../../../src/lib/orca/patchers/rule/sveltekit";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "src"): PatchContext {
  return {
    framework: { id: "sveltekit", appDir, devPort: 5173, url: "http://localhost:5173" },
    rendererId: "svelte",
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

describe("SvelteKitPatcher.plan", () => {
  it("writes the server hook and file-based routes under src/", () => {
    const plan = new SvelteKitPatcher().plan(ctx());

    expect(writeContents(plan, "src/hooks.server.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/hooks.server.ts")).toContain("@zitadel/sdk-sveltekit/server");
    expect(writeContents(plan, "src/hooks.server.ts")).toContain("createNextgenHandle");

    expect(writeContents(plan, "src/routes/+layout.svelte")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/+page.svelte")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login/+page.svelte")).toContain('purpose="login"');
    expect(writeContents(plan, "src/routes/register/+page.svelte")).toContain('purpose="register"');
    expect(writeContents(plan, "src/routes/profile/+page.svelte")).toContain("ZitadelLogout");
    expect(writeContents(plan, "src/routes/login/+page.svelte")).toContain("background:#0f0f11");
    expect(writeContents(plan, "src/routes/login/+page.svelte")).toContain("@zitadel/sdk-svelte");
    expect(writeContents(plan, "src/routes/login/+page.svelte")).toContain("ZitadelLogin");
  });

  const widgetPages = [
    "src/routes/login/+page.svelte",
    "src/routes/register/+page.svelte",
    "src/routes/profile/+page.svelte",
  ];

  // The widget must mount on the client only. onMount works on SvelteKit 2 and
  // 3, where `$app/environment` is deprecated and warns on every dev render.
  it.each(widgetPages)("mounts the widget in %s only after onMount", (path) => {
    expect(writeContents(new SvelteKitPatcher().plan(ctx()), path)).toMatch(
      /let mounted = \$state\(false\);\s+onMount\(\(\) => \{\s+mounted = true;\s+\}\);[\s\S]*\{#if mounted\}/,
    );
  });

  it.each(widgetPages)("does not import the deprecated $app/environment in %s", (path) => {
    expect(writeContents(new SvelteKitPatcher().plan(ctx()), path)).not.toContain(
      'from "$app/environment"',
    );
  });

  it("seeds the public project id and edits no config but the dev script", () => {
    const plan = new SvelteKitPatcher().plan(ctx());
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

  it("adds the server SDK + the Svelte component lib at the CLI's prerelease tag", () => {
    const deps = new SvelteKitPatcher()
      .plan(ctx())
      .ops.filter((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-sveltekit", version: "alpha" }),
    );
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-svelte", version: "alpha" }),
    );
  });
});

describe("SvelteKitPatcher.artifacts", () => {
  it("lists the routes + hook as managed, the SDK as a dependency, no config edits", () => {
    const artifacts = new SvelteKitPatcher().artifacts({
      framework: { id: "sveltekit", appDir: "src", devPort: 5173, url: "http://localhost:5173" },
      rendererId: "svelte",
    });
    expect(artifacts.markedFiles).toContain("src/hooks.server.ts");
    expect(artifacts.markedFiles).toContain("src/routes/login/+page.svelte");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-sveltekit", "@zitadel/sdk-svelte"]);
    expect(artifacts.configEdits).toEqual(["package.json"]);
  });
});

describe("SvelteKitPatcher.canPatch", () => {
  it("matches sveltekit only", () => {
    const patcher = new SvelteKitPatcher();
    expect(patcher.canPatch("sveltekit")).toBe(true);
    expect(patcher.canPatch("svelte")).toBe(false);
  });
});

describe("SvelteKitPatcher dev server port", () => {
  // Setup registers one origin; a dev server on any other port is refused.
  it("pins the dev script to the registered port, strictly", () => {
    const op = new SvelteKitPatcher()
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
