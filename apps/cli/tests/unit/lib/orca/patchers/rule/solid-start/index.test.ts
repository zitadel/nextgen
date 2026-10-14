import { describe, expect, it } from "vitest";

import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import { SolidStartPatcher } from "../../../../../../../src/lib/orca/patchers/rule/solid-start";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(appDir = "src"): PatchContext {
  return {
    framework: { id: "solid-start", appDir, devPort: 3000, url: "http://localhost:3000" },
    rendererId: "solid",
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

describe("SolidStartPatcher.plan", () => {
  it("writes the middleware and file-based routes under src/", () => {
    const plan = new SolidStartPatcher().plan(ctx());

    expect(writeContents(plan, "src/middleware.ts")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/middleware.ts")).toContain("@zitadel/sdk-solid-start/server");
    expect(writeContents(plan, "src/middleware.ts")).toContain("createNextgenMiddleware");
    // SolidStart 2 registers the default export as an array of h3 middleware, so
    // the config object must be wrapped in SolidStart's createMiddleware — a bare
    // createNextgenMiddleware(...) export registers nothing and /__nextgen/* 404s.
    expect(writeContents(plan, "src/middleware.ts")).toContain(
      'import { createMiddleware } from "@solidjs/start/middleware"',
    );
    expect(writeContents(plan, "src/middleware.ts")).toContain("export default createMiddleware(");

    expect(writeContents(plan, "src/routes/index.tsx")).toContain(MANAGED_MARKER);
    expect(writeContents(plan, "src/routes/login.tsx")).toContain('purpose="login"');
    expect(writeContents(plan, "src/routes/register.tsx")).toContain('purpose="register"');
    expect(writeContents(plan, "src/routes/profile.tsx")).toContain("ZitadelSession");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("background:#0f0f11");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("@zitadel/sdk-solid");
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("ZitadelLogin");
    // The widget registers Lit custom elements (customElements.define) at import
    // time, which crashes SSR. It must be loaded via SolidStart's clientOnly, not
    // imported at module scope, or the server render of the route throws.
    expect(writeContents(plan, "src/routes/login.tsx")).toContain(
      'import { clientOnly } from "@solidjs/start"',
    );
    expect(writeContents(plan, "src/routes/login.tsx")).toContain("clientOnly(() =>");
    expect(writeContents(plan, "src/routes/profile.tsx")).toContain("clientOnly(() =>");
  });

  it("seeds the public project id and edits vite.config", () => {
    const plan = new SolidStartPatcher().plan(ctx());
    const envOp = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "merge-env" }> =>
        op.kind === "merge-env" &&
        op.path === ".env.local" &&
        "VITE_ZITADEL_PROJECT_ID" in op.entries,
    );
    expect(envOp?.entries).toMatchObject({ VITE_ZITADEL_PROJECT_ID: "proj-1" });

    const edit = plan.ops.find(
      (op): op is Extract<FileOp, { kind: "edit" }> =>
        op.kind === "edit" && String(op.path).includes("vite.config"),
    );
    expect(edit?.path).toContain("vite.config.ts");
  });

  it("adds the SDK + component dependencies at the CLI's exact version", () => {
    const deps = new SolidStartPatcher()
      .plan(ctx())
      .ops.filter((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-solid-start", version: "0.1.0-alpha.0" }),
    );
    expect(deps).toContainEqual(
      expect.objectContaining({ name: "@zitadel/sdk-solid", version: "0.1.0-alpha.0" }),
    );
  });

  const businessPages = ["src/routes/login.tsx", "src/routes/register.tsx"];

  // Minimal and consumer scaffolds keep the widget's neutral built-in copy.
  it.each(businessPages)("keeps the neutral copy in %s by default", (path) => {
    expect(writeContents(new SolidStartPatcher().plan(ctx()), path)).not.toContain(
      "businessLocales",
    );
  });

  it.each(businessPages)("keeps the neutral copy in %s for consumer projects", (path) => {
    expect(
      writeContents(new SolidStartPatcher().plan({ ...ctx(), useCase: "consumer" }), path),
    ).not.toContain("businessLocales");
  });

  it.each(businessPages)(
    "imports the business copy overlay in %s for business projects",
    (path) => {
      expect(
        writeContents(new SolidStartPatcher().plan({ ...ctx(), useCase: "business" }), path),
      ).toContain(
        'import("@zitadel/sdk-solid").then(({ ZitadelLogin: Login, businessLocales }) =>',
      );
    },
  );

  it.each(businessPages)("passes the business copy overlay in %s for business projects", (path) => {
    expect(
      writeContents(new SolidStartPatcher().plan({ ...ctx(), useCase: "business" }), path),
    ).toContain("<Login {...props} locales={businessLocales} />");
  });

  // The overlay ships in the client-only module, so the loader must not pull
  // @zitadel/sdk-solid in at module scope to reach it.
  it.each(businessPages)(
    "keeps @zitadel/sdk-solid client-only in %s for business projects",
    (path) => {
      expect(
        writeContents(new SolidStartPatcher().plan({ ...ctx(), useCase: "business" }), path),
      ).not.toMatch(/^import .* from "@zitadel\/sdk-solid";$/m);
    },
  );
});

describe("SolidStartPatcher.artifacts", () => {
  it("lists the routes + middleware as managed, the SDK as a dependency, vite.config as a manual edit", () => {
    const artifacts = new SolidStartPatcher().artifacts({
      framework: { id: "solid-start", appDir: "src", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "solid",
    });
    expect(artifacts.markedFiles).toContain("src/middleware.ts");
    expect(artifacts.markedFiles).toContain("src/routes/login.tsx");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-solid-start", "@zitadel/sdk-solid"]);
    expect(artifacts.configEdits).toEqual(["vite.config.*", "package.json"]);
  });
});

describe("SolidStartPatcher.canPatch", () => {
  it("matches solid-start only", () => {
    const patcher = new SolidStartPatcher();
    expect(patcher.canPatch("solid-start")).toBe(true);
    expect(patcher.canPatch("solid")).toBe(false);
  });
});

describe("SolidStartPatcher dev server port", () => {
  // Setup registers one origin; a dev server on any other port is refused.
  it("pins the dev script to the registered port, strictly", () => {
    const op = new SolidStartPatcher()
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

describe("SolidStartPatcher vite.config wiring", () => {
  // Without the middleware registration the proxy and session check never run.
  it("marks the middleware registration as infrastructure wiring", () => {
    const op = new SolidStartPatcher()
      .plan(ctx())
      .ops.find(
        (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
          candidate.kind === "edit" && Array.isArray(candidate.path),
      );

    expect(op?.wiring).toBe("infrastructure");
  });
});
