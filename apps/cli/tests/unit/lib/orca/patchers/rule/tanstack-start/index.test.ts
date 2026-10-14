import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { TanStackStartPatcher } from "../../../../../../../src/lib/orca/patchers/rule/tanstack-start";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "src"): PatchContext {
  return {
    framework: { id: "tanstack-start", appDir, devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      preview_origins: [],
      created_at: "2026-01-01T00:00:00.000Z",
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

describe("TanStackStartPatcher.plan", () => {
  it("writes the request-middleware start entry and file-based routes under src/", () => {
    const plan = new TanStackStartPatcher().plan(ctx());

    expect(writeContents(plan, "src/start.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/start.ts")).toContain("@zitadel/sdk-tanstack-start/server");
    expect(writeContents(plan, "src/start.ts")).toContain("createNextgenRequestMiddleware");
    // src/start.ts is TanStack's reserved server entry: it must export a
    // `startInstance` from `createStart`, not call `registerGlobalMiddleware`.
    expect(writeContents(plan, "src/start.ts")).toContain("createStart");
    expect(writeContents(plan, "src/start.ts")).toContain("export const startInstance");
    // Writing src/start.ts opts the app out of TanStack Start's auto-installed
    // CSRF middleware, so the managed entry must restore it explicitly.
    expect(writeContents(plan, "src/start.ts")).toContain("createCsrfMiddleware");

    expect(writeContents(plan, "src/routes/index.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login.tsx")).toContain(
      "@zitadel/sdk-tanstack-start/react",
    );
    expect(writeContents(plan, "src/routes/login.tsx")).toContain('purpose="login"');
    expect(writeContents(plan, "src/routes/register.tsx")).toContain('purpose="register"');
    expect(writeContents(plan, "src/routes/profile.tsx")).toContain("ZitadelSession");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("#0f0f11");
  });

  // CSRF must run before auth, so a cross-site server-function call is
  // rejected before any session work.
  it("orders the CSRF middleware ahead of auth", () => {
    expect(writeContents(new TanStackStartPatcher().plan(ctx()), "src/start.ts")).toContain(
      "requestMiddleware: [csrfMiddleware, authMiddleware]",
    );
  });

  // protectedRoutes only sees document requests; a client-side <Link> never
  // reaches the request middleware, so the route guards itself.
  it("guards the profile route in beforeLoad through a server function", () => {
    const profile = writeContents(new TanStackStartPatcher().plan(ctx()), "src/routes/profile.tsx");

    expect(profile).toContain(
      "const fetchAuth = createServerFn().handler(({ context }) => getAuth(context));",
    );
  });

  it("redirects a signed-out profile visit to login from beforeLoad", () => {
    const profile = writeContents(new TanStackStartPatcher().plan(ctx()), "src/routes/profile.tsx");

    expect(profile).toMatch(
      /beforeLoad: async \(\) => \{\s+const auth = await fetchAuth\(\);\s+if \(!auth\.isAuthenticated\) \{\s+throw redirect\(\{ to: "\/login" \}\);/,
    );
  });

  it("seeds the public project id and edits no config but the dev script", () => {
    const plan = new TanStackStartPatcher().plan(ctx());
    const envOp = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "merge-env" }> =>
        op.kind === "merge-env" &&
        op.path === ".env.local" &&
        "VITE_ZITADEL_PROJECT_ID" in op.entries,
    );
    expect(envOp?.entries).toMatchObject({ VITE_ZITADEL_PROJECT_ID: "proj-1" });
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

  it("adds the SDK dependency at the CLI's prerelease tag", () => {
    const dep = new TanStackStartPatcher()
      .plan(ctx())
      .ops.find((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(dep).toMatchObject({ name: "@zitadel/sdk-tanstack-start", version: "alpha" });
  });
});

describe("TanStackStartPatcher.artifacts", () => {
  it("lists the routes + start entry as managed, the SDK as a dependency, no config edits", () => {
    const artifacts = new TanStackStartPatcher().artifacts({
      framework: {
        id: "tanstack-start",
        appDir: "src",
        devPort: 3000,
        url: "http://localhost:3000",
      },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("src/start.ts");
    expect(artifacts.markedFiles).toContain("src/routes/login.tsx");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-tanstack-start"]);
    expect(artifacts.configEdits).toEqual(["package.json"]);
  });
});

describe("TanStackStartPatcher.canPatch", () => {
  it("matches tanstack-start only", () => {
    const patcher = new TanStackStartPatcher();
    expect(patcher.canPatch("tanstack-start")).toBe(true);
    expect(patcher.canPatch("react")).toBe(false);
  });
});

describe("TanStackStartPatcher dev server port", () => {
  // Setup registers one origin; a dev server on any other port is refused.
  it("pins the dev script to the registered port, strictly", () => {
    const op = new TanStackStartPatcher()
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
