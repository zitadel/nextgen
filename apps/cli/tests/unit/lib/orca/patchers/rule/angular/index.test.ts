import { describe, expect, it } from "vitest";

import { AngularPatcher } from "../../../../../../../src/lib/orca/patchers/rule/angular";
import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";

function ctx(): PatchContext {
  return {
    framework: { id: "angular", appDir: "src/app", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      projectSecret: "sk_full",
      previewSecret: "sk_preview",
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

function packageJsonEdit(): (source: string | undefined) => string {
  const op = new AngularPatcher()
    .plan(ctx())
    .ops.find(
      (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
        candidate.kind === "edit" && candidate.path === "package.json",
    );
  if (!op) {
    throw new Error("expected a package.json edit op in the Angular plan");
  }
  return op.edit;
}

function proxyConfigEdit(): (source: string | undefined) => string {
  const op = new AngularPatcher()
    .plan(ctx())
    .ops.find(
      (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
        candidate.kind === "edit" && candidate.path === "proxy.conf.cjs",
    );
  if (!op) {
    throw new Error("expected a proxy.conf.cjs edit op in the Angular plan");
  }
  return op.edit;
}

describe("AngularPatcher.plan", () => {
  it("wires the business copy overlay for business-use-case projects", () => {
    // Minimal scaffolds keep the widget's neutral built-in copy.
    const minimal = new AngularPatcher().plan(ctx());
    expect(writeContents(minimal, "src/app/app.ts")).not.toContain("businessLocales");
    expect(writeContents(minimal, "src/app/app.html")).not.toContain("[locales]");
    const business = new AngularPatcher().plan({ ...ctx(), useCase: "business" });
    // The overlay ships with the SDK; the component exposes it as a class
    // property and the template binds it, and the wrapper component assigns
    // the input as a DOM property internally.
    expect(writeContents(business, "src/app/app.ts")).toContain("businessLocales,");
    expect(writeContents(business, "src/app/app.ts")).toContain(
      "protected readonly locales = businessLocales;",
    );
    expect(writeContents(business, "src/app/app.html")).toContain('[locales]="locales"');
    // Consumer scaffolds keep the neutral built-ins, like minimal ones.
    const consumer = new AngularPatcher().plan({ ...ctx(), useCase: "consumer" });
    expect(writeContents(consumer, "src/app/app.ts")).not.toContain("businessLocales");
  });

  it("writes the managed root component, template, and proxy config", () => {
    const plan = new AngularPatcher().plan(ctx());
    expect(writeContents(plan, "src/app/app.ts")).toContain(MANAGED_MARKER);
    const appHtml = writeContents(plan, "src/app/app.html");
    expect(appHtml).toContain(MANAGED_MARKER);
    expect(appHtml).toContain(`[postSignInUrl]="'/profile'"`);
    expect(appHtml).toContain(`[postSignOutUrl]="'/login'"`);
    expect(plan.ops.some((op) => op.kind === "edit" && op.path === "src/app/app.routes.ts")).toBe(
      true,
    );
    const proxy = proxyConfigEdit()(undefined);
    expect(proxy).toContain(MANAGED_MARKER);
    expect(proxy).toContain('proxyReq.method === "POST"');
    expect(proxy).toContain('pathname === "/sessions/exchange"');
    expect(proxy).toContain('!proxyReq.getHeader("authorization")');
    expect(plan.ops.some((op) => op.kind === "edit" && op.path === "angular.json")).toBe(true);
  });

  it("migrates only the legacy managed proxy bearer hook", () => {
    const edit = proxyConfigEdit();
    const legacy = edit(undefined).replace(
      `/* zitadel:proxy:v2 */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    pathname === "/sessions/exchange" &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`,
      `function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}`,
    );

    const migrated = edit(`${legacy}\n// preserved user note\n`);
    expect(migrated).toContain('pathname === "/sessions/exchange"');
    expect(migrated).toContain("// preserved user note");

    const custom = `// user-owned\nfunction setBearer(proxyReq) {\n  proxyReq.setHeader("authorization", bearer);\n}\n`;
    expect(edit(custom)).toBe(custom);
  });

  it("flags a reformatted unsafe legacy proxy for manual review", () => {
    const edit = proxyConfigEdit();
    const unsafe = edit(undefined).replace(
      `/* zitadel:proxy:v2 */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    pathname === "/sessions/exchange" &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`,
      `function setBearer(proxyReq) {
  proxyReq
    .setHeader("authorization", bearer);
}`,
    );

    expect(() => edit(unsafe)).toThrowError(
      /may forward ZITADEL_PROJECT_SECRET outside POST \/sessions\/exchange/,
    );
  });

  it("adds a `dev` npm script so `npm run dev` works like the other frameworks", () => {
    const result = JSON.parse(packageJsonEdit()(`{ "scripts": { "start": "ng serve" } }`));
    expect(result.scripts.dev).toBe("ng serve");
    expect(result.scripts.start).toBe("ng serve");
  });

  it("preserves an existing `dev` script instead of overwriting it", () => {
    const result = JSON.parse(packageJsonEdit()(`{ "scripts": { "dev": "ng serve --hmr" } }`));
    expect(result.scripts.dev).toBe("ng serve --hmr");
  });

  it("fails fast when package.json is absent instead of fabricating one", () => {
    expect(() => packageJsonEdit()(undefined)).toThrowError(/package\.json is required/);
  });

  it("adds the SDK dependency at the CLI's prerelease tag", () => {
    const dep = new AngularPatcher()
      .plan(ctx())
      .ops.find((op): op is Extract<FileOp, { kind: "add-dep" }> => op.kind === "add-dep");
    expect(dep).toMatchObject({ name: "@zitadel/sdk-angular", version: "alpha" });
  });
});

describe("AngularPatcher.artifacts", () => {
  it("lists the component files as managed and the config edits as manual cleanup", () => {
    const artifacts = new AngularPatcher().artifacts({
      framework: { id: "angular", appDir: "src/app", devPort: 3000, url: "http://localhost:3000" },
      rendererId: "react",
    });
    expect(artifacts.markedFiles).toContain("src/app/app.ts");
    expect(artifacts.dependencies).toEqual(["@zitadel/sdk-angular"]);
    expect(artifacts.configEdits).toEqual([
      "angular.json",
      "src/app/app.routes.ts",
      "package.json",
    ]);
  });
});
