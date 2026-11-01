import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it, vi } from "vitest";

import { FRAMEWORK_IDS } from "../../../../../../helpers/framework-ids";
import { AngularPatcher } from "../../../../../../../src/lib/orca/patchers/rule/angular";
import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import {
  proxyConfApiPrefixEdit,
  proxyConfApiPrefixVerdict,
} from "../../../../../../../src/lib/orca/patchers/rule/angular/templates";
import { SESSION_COOKIE_MARKER } from "../../../../../../../src/lib/orca/patchers/rule/session-cookie";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";
import { REMOTE_HOST, useRemoteServer } from "../../../../../../helpers/remote-server";
import { bearerOnlyProxyConf, v1ProxyConf } from "../../../../../../helpers/proxy-conf";
import { aProxyConfApp, type DevApp } from "../../../../../../helpers/vite";

/** The bearer hook setup writes: the exchange with and without the API prefix. */
const BEARER = `/* zitadel:proxy:v3 */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    (pathname === "/sessions/exchange" || pathname === "/api/v1/sessions/exchange") &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`;

/** The bearer hook as setup wrote it before it knew the API prefix (ADR 077). */
const V2_BEARER = `/* zitadel:proxy:v2 */
function setBearer(proxyReq) {
  const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
  if (
    proxyReq.method === "POST" &&
    pathname === "/sessions/exchange" &&
    !proxyReq.getHeader("authorization")
  ) {
    proxyReq.setHeader("authorization", bearer);
  }
}`;

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

/** The session-cookie op's own doctor verdict. */
function sessionCookieVerdict(): NonNullable<Extract<FileOp, { kind: "edit" }>["verify"]> {
  const op = new AngularPatcher()
    .plan(ctx())
    .ops.filter(
      (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
        candidate.kind === "edit" && candidate.path === "proxy.conf.cjs",
    )
    .find((candidate) => candidate.wiring === "convenience");
  if (!op?.verify) {
    throw new Error("expected the session-cookie op to bring its own verify");
  }
  return op.verify;
}

/** The managed proxy.conf.cjs the first CLI alphas wrote: it read zitadel.json, and had no `env`. */
const FIRST_ALPHA_PROXY_CONF = `${MANAGED_MARKER}
const { readFileSync } = require("node:fs");

const config = JSON.parse(readFileSync("zitadel.json", "utf8"));
if (!config.project || !config.server) {
  throw new Error("zitadel.json is missing \\"project\\" or \\"server\\"; re-run zitadel setup.");
}
const bearer = \`Bearer sk_\${config.project}\`;

function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}

function stripPrefix(path) {
  return path.replace(/^\\/__nextgen/, "").replace(/^(?!\\/)/, "/");
}

module.exports = {
  "/__nextgen": {
    target: config.server,
    changeOrigin: false,
    pathRewrite: stripPrefix,
    rewrite: stripPrefix,
    onProxyReq: setBearer,
    configure: (proxy) => proxy.on("proxyReq", setBearer),
  },
};
`;

/** Runs a `proxy.conf.cjs` as Node would load it, with `files` as the only ones `node:fs` sees. */
function loadProxyConf(source: string, files: Record<string, string>): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  const fs = {
    existsSync: (path: string) => path in files,
    readFileSync: (path: string) => {
      const contents = files[path];
      if (contents === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return contents;
    },
  };
  runInNewContext(source, {
    module,
    exports: module.exports,
    require: (id: string) => (id === "node:fs" ? fs : undefined),
    process: { env: {} },
    URL,
    TextEncoder,
  });
  return module.exports;
}

/** The `proxy.conf.cjs` edit that gives the managed proxy its session-cookie hooks. */
function sessionCookieEdit(): (source: string | undefined) => string {
  const op = new AngularPatcher()
    .plan(ctx())
    .ops.find(
      (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
        candidate.kind === "edit" &&
        candidate.path === "proxy.conf.cjs" &&
        candidate.wiring === "convenience",
    );
  if (!op) {
    throw new Error("expected a convenience proxy.conf.cjs edit op in the Angular plan");
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
    expect(proxy).toContain(BEARER);
    // The backend by its own name, the app's origin in X-Forwarded-*.
    expect(proxy).toContain("    changeOrigin: true,\n    xfwd: true,\n");
    expect(plan.ops.some((op) => op.kind === "edit" && op.path === "angular.json")).toBe(true);
  });

  it("keeps the app's session cookie under its project's name", () => {
    const proxy = proxyConfigEdit()(undefined);

    expect(proxy).toContain(SESSION_COOKIE_MARKER);
    expect(proxy).toContain(
      'process.env.ZITADEL_PROJECT_ID ?? (typeof env === "undefined" ? undefined : env.ZITADEL_PROJECT_ID)',
    );
    expect(proxy).toContain("onProxyRes: renameSessionCookie,");
  });

  // A file saved on Windows: the exact text the edits look for has LF line ends.
  it("gives a CRLF managed proxy the session-cookie hooks with CRLF line ends", () => {
    const crlf = bearerOnlyProxyConf().replace(/\n/g, "\r\n");

    const out = sessionCookieEdit()(crlf);

    expect(out).toBe(proxyConfigEdit()(undefined).replace(/\n/g, "\r\n"));
    expect(sessionCookieEdit()(out)).toBe(out);
    expect(sessionCookieVerdict()(crlf)).toBe("detached");
    expect(sessionCookieVerdict()(out)).toBe("applied");
  });

  it("migrates a CRLF legacy managed proxy's bearer hook", () => {
    const legacy = proxyConfigEdit()(undefined).replace(
      BEARER,
      'function setBearer(proxyReq) {\n  proxyReq.setHeader("authorization", bearer);\n}',
    );
    expect(legacy).not.toContain("zitadel:proxy:");

    const out = proxyConfigEdit()(legacy.replace(/\n/g, "\r\n"));

    expect(out).toBe(proxyConfigEdit()(undefined).replace(/\n/g, "\r\n"));
  });

  // The first alphas read zitadel.json, not .env.local into `env`. Their
  // bearer hook migrates to the current one, after which the session-cookie
  // edit recognizes the file; the hooks must not assume `env`.
  it("upgrades a managed proxy from before it read .env.local into a file that loads", () => {
    const upgraded = sessionCookieEdit()(proxyConfigEdit()(FIRST_ALPHA_PROXY_CONF));
    expect(upgraded).toContain(SESSION_COOKIE_MARKER);

    const loaded = loadProxyConf(upgraded, {
      "zitadel.json": '{"project":"p","server":"http://s"}',
    });
    const proxyReq = {
      path: "/sessions/me",
      method: "GET",
      getHeader: () => "a=1",
      setHeader: vi.fn(),
    };
    (loaded["/__nextgen"] as { onProxyReq(proxyReq: unknown): void }).onProxyReq(proxyReq);

    // No project id in the environment: the cookies pass through.
    expect(proxyReq.setHeader).not.toHaveBeenCalled();
  });

  it("reads a managed proxy changed by hand as unknown, not applied", () => {
    const custom = bearerOnlyProxyConf().replace(
      "    onProxyReq: setBearer,\n",
      "    onProxyReq: (proxyReq) => setBearer(proxyReq),\n",
    );

    expect(sessionCookieEdit()(custom)).toBe(custom);
    expect(sessionCookieVerdict()(custom)).toEqual({
      unknown: expect.stringContaining("must be added by hand"),
    });
  });

  it("gives the managed proxy it wrote before the session-cookie hooks", () => {
    expect(sessionCookieEdit()(bearerOnlyProxyConf())).toBe(proxyConfigEdit()(undefined));
  });

  it("replaces the session-cookie hooks it wrote before ADR 083", () => {
    const out = sessionCookieEdit()(v1ProxyConf());

    expect(out).toBe(proxyConfigEdit()(undefined));
    expect(sessionCookieVerdict()(out)).toBe("applied");
  });

  // They keep the session in cookies the server no longer reads.
  it("fails the doctor on the session-cookie hooks it wrote before ADR 083", () => {
    expect(sessionCookieVerdict()(v1ProxyConf())).toEqual({
      outdated: expect.stringContaining("doctor --fix updates them"),
    });
  });

  it("leaves hooks from before ADR 083 that were changed by hand to the developer", () => {
    const changed = v1ProxyConf().replace(
      "function renameSessionCookie(proxyRes) {",
      'function renameSessionCookie(proxyRes) {\n  console.debug("cookies");',
    );

    expect(sessionCookieEdit()(changed)).toBe(changed);
    expect(sessionCookieVerdict()(changed)).toEqual({
      outdated: expect.stringContaining("must be updated by hand"),
    });
  });

  it("leaves a managed proxy whose hooks were attached by hand alone", () => {
    const custom = bearerOnlyProxyConf().replace(
      "    onProxyReq: setBearer,\n",
      "    onProxyReq: (proxyReq) => setBearer(proxyReq),\n",
    );

    expect(sessionCookieEdit()(custom)).toBe(custom);
  });

  it("leaves an unmanaged proxy without the session-cookie hooks", () => {
    const custom = bearerOnlyProxyConf().replace(`${MANAGED_MARKER}\n`, "");

    expect(sessionCookieEdit()(custom)).toBe(custom);
  });

  it("only warns in the doctor while the session-cookie hooks are missing", () => {
    const ops = new AngularPatcher()
      .plan(ctx())
      .ops.filter((op) => op.kind === "edit" && op.path === "proxy.conf.cjs");

    expect(ops.map((op) => (op.kind === "edit" ? op.wiring : undefined))).toEqual([
      "infrastructure",
      "convenience",
      "infrastructure",
    ]);
  });

  it("moves the proxy entry it wrote before onto the origin-forwarding shape", () => {
    const edit = proxyConfigEdit();

    expect(edit(previousProxyConf())).toBe(edit(undefined));
  });

  it("migrates a legacy proxy's bearer hook and its entry together", () => {
    const edit = proxyConfigEdit();
    const legacy = previousProxyConf().replace(
      BEARER,
      `function setBearer(proxyReq) {\n  proxyReq.setHeader("authorization", bearer);\n}`,
    );
    expect(legacy).not.toBe(previousProxyConf());

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
      BEARER,
      `function setBearer(proxyReq) {
  proxyReq.setHeader("authorization", bearer);
}`,
    );
    expect(legacy).not.toContain(BEARER);

    const migrated = edit(`${legacy}\n// preserved user note\n`);
    expect(migrated).toContain(BEARER);
    expect(migrated).toContain("// preserved user note");

    const custom = `// user-owned\nfunction setBearer(proxyReq) {\n  proxyReq.setHeader("authorization", bearer);\n}\n`;
    expect(edit(custom)).toBe(custom);
  });

  it("flags a reformatted unsafe legacy proxy for manual review", () => {
    const edit = proxyConfigEdit();
    const unsafe = edit(undefined).replace(
      BEARER,
      `function setBearer(proxyReq) {
  proxyReq
    .setHeader("authorization", bearer);
}`,
    );
    expect(unsafe).not.toContain(BEARER);

    expect(() => edit(unsafe)).toThrowError(
      /may forward ZITADEL_PROJECT_SECRET outside POST \/sessions\/exchange/,
    );
  });

  it("moves the managed proxy's v2 bearer hook to the exchange with and without the API prefix", () => {
    const current = proxyConfigEdit()(undefined);
    const v2 = current.replace(BEARER, V2_BEARER);
    expect(v2).not.toBe(current);

    expect(proxyConfApiPrefixEdit()(v2)).toBe(current);
    expect(proxyConfApiPrefixEdit()(current)).toBe(current);
    expect(proxyConfApiPrefixEdit()(v2.replace(/\n/g, "\r\n"))).toBe(
      current.replace(/\n/g, "\r\n"),
    );
  });

  it("gives the managed proxy it wrote before the session-cookie hooks both, whatever the order", () => {
    const v2 = bearerOnlyProxyConf().replace(BEARER, V2_BEARER);

    expect(proxyConfApiPrefixEdit()(sessionCookieEdit()(v2))).toBe(proxyConfigEdit()(undefined));
    expect(sessionCookieEdit()(proxyConfApiPrefixEdit()(v2))).toBe(proxyConfigEdit()(undefined));
  });

  it("fails the doctor while the v2 bearer hook is there", () => {
    const current = proxyConfigEdit()(undefined);
    const v2 = current.replace(BEARER, V2_BEARER);

    expect(proxyConfApiPrefixVerdict(current)).toBe("applied");
    expect(proxyConfApiPrefixVerdict(v2)).toBe("detached");
    expect(
      new AngularPatcher()
        .plan(ctx())
        .ops.some(
          (op) =>
            op.kind === "edit" &&
            op.path === "proxy.conf.cjs" &&
            op.wiring === "infrastructure" &&
            op.verify === proxyConfApiPrefixVerdict,
        ),
    ).toBe(true);
  });

  it("leaves a v2 bearer hook changed by hand, and reads it as unknown", () => {
    const changed = proxyConfigEdit()(undefined).replace(
      BEARER,
      V2_BEARER.replace("  ) {\n", '  ) {\n    console.debug("exchange");\n'),
    );

    expect(proxyConfApiPrefixEdit()(changed)).toBe(changed);
    expect(proxyConfApiPrefixVerdict(changed)).toEqual({
      unknown: expect.stringContaining("must accept /api/v1/sessions/exchange by hand"),
    });
  });

  it("leaves an unmanaged proxy alone, and reads it as unknown while it knows only the bare exchange", () => {
    const custom = proxyConfigEdit()(undefined)
      .replace(`${MANAGED_MARKER}\n`, "")
      .replace(BEARER, V2_BEARER);

    expect(proxyConfApiPrefixEdit()(custom)).toBe(custom);
    expect(proxyConfApiPrefixVerdict(custom)).toEqual({
      unknown: expect.stringContaining("not the proxy zitadel setup writes"),
    });
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
    expect(dep).toMatchObject({ name: "@zitadel/sdk-angular", version: "0.1.0-alpha.0" });
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

/**
 * Every session cookie a browser on the app's host may hold but the app's own:
 * the server's under both names, another project's app's, and those from
 * before ADR 083.
 */
const OTHER_SESSION_COOKIES = [
  "zitadel_session=console",
  "__Host-zitadel_session=console",
  "zitadel_session_proj_other=other",
  "__Host-zitadel_session_proj_other=other",
  "__nextgen_session=old",
  "__nextgen_session_proj_spa=old",
].join("; ");

describe("the generated proxy.conf.cjs, run by Vite against a remote https server", () => {
  const remote = useRemoteServer();
  let app: DevApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    remote.answerWith(undefined);
  });

  async function serve(proxyConf: string, projectId = ""): Promise<DevApp> {
    app = await aProxyConfApp(proxyConf, {
      ZITADEL_URL: remote.url,
      ZITADEL_PROJECT_SECRET: "sk_proj_test",
      ZITADEL_PROJECT_ID: projectId,
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

  it("attaches the project secret to the session exchange under the API prefix too", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    await fetch(`${origin}/__nextgen/api/v1/sessions/exchange`, { method: "POST" });
    await fetch(`${origin}/__nextgen/api/v1/sessions/me`);

    const [exchange, me] = remote.requests.slice(-2);
    expect(exchange?.path).toBe("/api/v1/sessions/exchange");
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

  it("sends the app's session cookie to the server under the server's name", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined), "proj_spa");

    await fetch(`${origin}/__nextgen/users/me`, {
      headers: { cookie: `theme=dark; ${OTHER_SESSION_COOKIES}; zitadel_session_proj_spa=mine` },
    });

    expect(remote.requests.at(-1)?.headers.cookie).toBe("theme=dark; __Host-zitadel_session=mine");
  });

  // The remote server is https, so it sets the prefixed name with Secure; the
  // app on loopback http keeps it without either.
  it("keeps the session cookie the server sets under the app's project's name", async () => {
    remote.answerWith({
      "set-cookie":
        "__Host-zitadel_session=minted; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax",
    });
    const { origin } = await serve(proxyConfigEdit()(undefined), "proj_spa");

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(response.headers.getSetCookie()).toEqual([
      "zitadel_session_proj_spa=minted; Path=/; Max-Age=60; HttpOnly; SameSite=Lax",
    ]);
  });

  it("drops a session cookie from before ADR 083 the server sets", async () => {
    remote.answerWith({ "set-cookie": "__nextgen_session=minted; Path=/" });
    const { origin } = await serve(proxyConfigEdit()(undefined), "proj_spa");

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("passes the cookies through when no project is configured", async () => {
    remote.answerWith({ "set-cookie": "__Host-zitadel_session=minted; Path=/; Secure" });
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/me`, {
      headers: { cookie: "zitadel_session=tok" },
    });

    expect(remote.requests.at(-1)?.headers.cookie).toBe("zitadel_session=tok");
    expect(response.headers.getSetCookie()).toEqual([
      "__Host-zitadel_session=minted; Path=/; Secure",
    ]);
  });

  it("keeps the session cookie per project once doctor --fix replaced the hooks before ADR 083", async () => {
    remote.answerWith({ "set-cookie": "__Host-zitadel_session=minted; Path=/; Secure" });
    const { origin } = await serve(sessionCookieEdit()(v1ProxyConf()), "proj_spa");

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, {
      method: "POST",
      headers: { cookie: "zitadel_session=console; zitadel_session_proj_spa=mine" },
    });

    expect(remote.requests.at(-1)?.headers.cookie).toBe("__Host-zitadel_session=mine");
    expect(response.headers.getSetCookie()).toEqual([
      "zitadel_session_proj_spa=minted; Path=/; HttpOnly; SameSite=Lax",
    ]);
  });
});

describe("AngularPatcher.canPatch", () => {
  it.each(FRAMEWORK_IDS)("matches %s only when it is its own framework", (id) => {
    expect(new AngularPatcher().canPatch(id)).toBe(id === "angular");
  });
});
