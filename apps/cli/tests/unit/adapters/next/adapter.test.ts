import { describe, expect, it } from "vitest";

import type { ProjectContext } from "../../../../src/adapters/index";
import { NextAdapter } from "../../../../src/adapters/next/adapter";
import type { FileOp } from "../../../../src/scaffolder/plan";
import type { RendererSpec } from "../../../../src/renderers/types";

/**
 * A fully-featured renderer literal: exposes every optional template
 * (provider, profilePage, customElementsDts) so planSetup emits all of its
 * conditional ops.
 */
const fullRenderer: RendererSpec = {
  id: "react",
  displayName: "React",
  status: "available",
  frameworks: ["next"],
  dependency: { name: "@zitadel-nextgen/sdk-react", version: "9.9.9" },
  templates: {
    provider: { filename: "providers.tsx", contents: "// PROVIDER" },
    authPage: (mode) => ({ mode, contents: `// AUTH ${mode.toUpperCase()}` }),
    profilePage: () => ({ contents: "// PROFILE" }),
    customElementsDts: () => ({ contents: "// CUSTOM ELEMENTS DTS" }),
  },
};

/**
 * A minimal renderer literal: only the required `authPage` template, no
 * optional pieces, so planSetup omits the provider / profile / dts ops.
 */
const minimalRenderer: RendererSpec = {
  id: "web-component",
  displayName: "Web Component",
  status: "available",
  frameworks: ["next"],
  dependency: { name: "@zitadel-nextgen/sdk-next", version: "1.0.0" },
  templates: {
    authPage: (mode) => ({ mode, contents: `// AUTH ${mode}` }),
  },
};

function makeContext(
  renderer: RendererSpec,
  appDir: "app" | "src/app" = "app",
): ProjectContext {
  return {
    cwd: "/tmp/project",
    packageManager: "pnpm",
    framework: { id: "next", appDir },
    config: {
      project_id: "proj-123",
      issuer: "https://issuer.example.com",
      preview_origins: ["http://localhost:3000"],
      userSchemaPath: ".zitadel/user-schema.json",
    },
    renderer,
    isInitialSetup: true,
  };
}

function writeOps(ops: FileOp[]): Extract<FileOp, { kind: "write" }>[] {
  return ops.filter((op): op is Extract<FileOp, { kind: "write" }> => op.kind === "write");
}

describe("NextAdapter.planAddLogin", () => {
  it("writes a login page under the app dir", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planAddLogin(makeContext(fullRenderer));
    const writes = writeOps(planResult.ops);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("app/login/page.tsx");
    expect(writes[0].contents).toContain("AUTH LOGIN");
  });

  it("places the login page under src/app when that is the app dir", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planAddLogin(makeContext(fullRenderer, "src/app"));
    expect(writeOps(planResult.ops)[0].path).toBe("src/app/login/page.tsx");
  });
});

describe("NextAdapter.planAddRegister", () => {
  it("writes a register page under the app dir", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planAddRegister(makeContext(fullRenderer));
    const writes = writeOps(planResult.ops);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe("app/register/page.tsx");
    expect(writes[0].contents).toContain("AUTH REGISTER");
  });
});

describe("NextAdapter.sdkDependency", () => {
  it("returns the renderer's dependency", () => {
    const adapter = new NextAdapter();
    expect(adapter.sdkDependency(makeContext(fullRenderer))).toEqual({
      name: "@zitadel-nextgen/sdk-react",
      version: "9.9.9",
    });
  });

  it("reflects the dependency of whichever renderer is in context", () => {
    const adapter = new NextAdapter();
    expect(adapter.sdkDependency(makeContext(minimalRenderer))).toEqual({
      name: "@zitadel-nextgen/sdk-next",
      version: "1.0.0",
    });
  });
});

describe("NextAdapter.planSetup (full renderer)", () => {
  it("scaffolds login, register, profile pages and the provider", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planSetup(makeContext(fullRenderer));
    const paths = writeOps(planResult.ops).map((op) => op.path);
    expect(paths).toContain("app/login/page.tsx");
    expect(paths).toContain("app/register/page.tsx");
    expect(paths).toContain("app/profile/page.tsx");
    expect(paths).toContain("app/providers.tsx");
  });

  it("writes middleware.ts at the project root carrying the managed marker", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planSetup(makeContext(fullRenderer));
    const middleware = writeOps(planResult.ops).find((op) => op.path === "middleware.ts");
    expect(middleware).toBeDefined();
    expect(middleware?.contents).toContain("zitadel-cli: managed-file");
    expect(middleware?.contents).toContain("nextgenMiddleware");
  });

  it("writes custom-elements.d.ts at the project root", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planSetup(makeContext(fullRenderer));
    const paths = writeOps(planResult.ops).map((op) => op.path);
    expect(paths).toContain("custom-elements.d.ts");
  });

  it("adds the renderer's SDK dependency as an add-dep op", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planSetup(makeContext(fullRenderer));
    const dep = planResult.ops.find(
      (op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep",
    );
    expect(dep).toEqual({
      kind: "add-dep",
      name: "@zitadel-nextgen/sdk-react",
      version: "9.9.9",
    });
  });

  it("includes a human-readable summary", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planSetup(makeContext(fullRenderer));
    expect(planResult.summary.length).toBeGreaterThan(0);
    expect(planResult.summary[0].detail).toContain("react");
  });
});

describe("NextAdapter.planSetup (minimal renderer)", () => {
  it("omits provider, profile and custom-elements ops when the renderer lacks them", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planSetup(makeContext(minimalRenderer));
    const paths = writeOps(planResult.ops).map((op) => op.path);
    expect(paths).toContain("app/login/page.tsx");
    expect(paths).toContain("app/register/page.tsx");
    expect(paths).toContain("middleware.ts");
    expect(paths).not.toContain("app/profile/page.tsx");
    expect(paths).not.toContain("app/providers.tsx");
    expect(paths).not.toContain("custom-elements.d.ts");
  });

  it("still adds the SDK dependency", async () => {
    const adapter = new NextAdapter();
    const planResult = await adapter.planSetup(makeContext(minimalRenderer));
    const dep = planResult.ops.find(
      (op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep",
    );
    expect(dep?.name).toBe("@zitadel-nextgen/sdk-next");
  });
});
