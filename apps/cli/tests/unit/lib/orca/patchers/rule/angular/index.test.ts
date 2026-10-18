import { afterEach, describe, expect, it } from "vitest";

import { FRAMEWORK_IDS } from "../../../../../../helpers/framework-ids";
import { AngularPatcher } from "../../../../../../../src/lib/orca/patchers/rule/angular";
import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";
import { REMOTE_HOST, useRemoteServer } from "../../../../../../helpers/remote-server";
import { aProxyConfApp, type DevApp } from "../../../../../../helpers/vite";

function ctx(): PatchContext {
  return {
    framework: { id: "angular", appDir: "src/app", devPort: 3000, url: "http://localhost:3000" },
    rendererId: "react",
    project: {
      id: "proj-1",
      project_secret: "sk_full",
      preview_secret: "sk_preview",
      origins: [],
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

/**
 * The managed proxy as setup wrote it before it forwarded the app's origin:
 * `changeOrigin: false` kept the browser's `Host`, and with it `localhost` as
 * the TLS server name.
 */
function previousProxyConf(): string {
  const current = proxyConfigEdit()(undefined);
  const previous = current.replace(
    "    changeOrigin: true,\n    xfwd: true,\n",
    "    changeOrigin: false,\n",
  );
  if (previous === current) {
    throw new Error("expected the origin-forwarding entry in the managed proxy");
  }
  return previous;
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
    // The backend by its own name, the app's origin in X-Forwarded-*.
    expect(proxy).toContain("    changeOrigin: true,\n    xfwd: true,\n");
    expect(plan.ops.some((op) => op.kind === "edit" && op.path === "angular.json")).toBe(true);
  });

  it("moves the proxy entry it wrote before onto the origin-forwarding shape", () => {
    const edit = proxyConfigEdit();

    expect(edit(previousProxyConf())).toBe(edit(undefined));
  });

  it("migrates a legacy proxy's bearer hook and its entry together", () => {
    const edit = proxyConfigEdit();
    const legacy = previousProxyConf().replace(
      /\/\* zitadel:proxy:v2 \*\/\nfunction setBearer\(proxyReq\) \{\n[\s\S]*?\n\}\n/,
      `function setBearer(proxyReq) {\n  proxyReq.setHeader("authorization", bearer);\n}\n`,
    );

    expect(edit(legacy)).toBe(edit(undefined));
  });

  it("leaves an unmanaged proxy that keeps the browser's Host alone", () => {
    const custom = previousProxyConf().replace(`${MANAGED_MARKER}\n`, "");

    expect(proxyConfigEdit()(custom)).toBe(custom);
  });

  it("keeps a managed entry whose forwarding was already chosen by hand", () => {
    const chosen = previousProxyConf().replace(
      "    changeOrigin: false,\n",
      "    changeOrigin: false,\n    xfwd: false,\n",
    );

    expect(proxyConfigEdit()(chosen)).toBe(chosen);
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

describe("the generated proxy.conf.cjs, run by Vite against a remote https server", () => {
  const remote = useRemoteServer();
  let app: DevApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function serve(proxyConf: string): Promise<DevApp> {
    app = await aProxyConfApp(proxyConf, {
      ZITADEL_URL: remote.url,
      ZITADEL_PROJECT_SECRET: "sk_proj_test",
    });
    return app;
  }

  it("reaches the server by its own name", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/healthz`);

    expect(response.status).toBe(200);
    expect(remote.requests.at(-1)).toMatchObject({
      path: "/healthz",
      servername: REMOTE_HOST,
      headers: { host: new URL(remote.url).host },
    });
  });

  it("tells the server the app's origin", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    await fetch(`${origin}/__nextgen/healthz`);

    expect(remote.requests.at(-1)?.headers).toMatchObject({
      "x-forwarded-host": new URL(origin).host,
      "x-forwarded-proto": "http",
    });
  });

  it("attaches the project secret to the session exchange only", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });
    await fetch(`${origin}/__nextgen/sessions/me`);

    const [exchange, me] = remote.requests.slice(-2);
    expect(exchange?.headers.authorization).toBe("Bearer sk_proj_test");
    expect(me?.headers.authorization).toBeUndefined();
  });

  it("could not reach it with the entry it wrote before", async () => {
    const { origin } = await serve(previousProxyConf());
    const reached = remote.requests.length;

    const response = await fetch(`${origin}/__nextgen/healthz`);

    expect(response.ok).toBe(false);
    expect(remote.requests).toHaveLength(reached);
  });
});

describe("AngularPatcher.canPatch", () => {
  it.each(FRAMEWORK_IDS)("matches %s only when it is its own framework", (id) => {
    expect(new AngularPatcher().canPatch(id)).toBe(id === "angular");
  });
});
