import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

import { FRAMEWORK_IDS } from "../../../../../../helpers/framework-ids";
import { AngularPatcher } from "../../../../../../../src/lib/orca/patchers/rule/angular";
import type {
  FileOp,
  ScaffoldPlan,
} from "../../../../../../../src/lib/orca/patchers/rule/file-writer/types";
import type { PatchContext } from "../../../../../../../src/lib/orca/patchers/types";
import { MANAGED_MARKER } from "../../../../../../../src/lib/paths";
import {
  withFirstAngularRequestHook,
  withFirstRedaction,
} from "../../../../../../helpers/legacy-proxy";
import {
  EXCHANGE_BODY,
  REMOTE_HOST,
  SESSION_COOKIE,
  SESSION_TOKEN,
  useRemoteServer,
} from "../../../../../../helpers/remote-server";
import { aProxyConfApp, type DevApp, deliveryOf, wireBodyOf } from "../../../../../../helpers/vite";

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

function proxyConfigReview(): (source: string, path: string) => string | undefined {
  const op = new AngularPatcher()
    .plan(ctx())
    .ops.find(
      (candidate): candidate is Extract<FileOp, { kind: "edit" }> =>
        candidate.kind === "edit" && candidate.path === "proxy.conf.cjs",
    );
  if (!op?.review) {
    throw new Error("expected a review on the proxy.conf.cjs edit op in the Angular plan");
  }
  return op.review;
}

/**
 * The managed proxy as setup wrote it before it kept the session token out of
 * the browser: it relayed every response body as the server sent it.
 */
function unredactedProxyConf(): string {
  const current = proxyConfigEdit()(undefined);
  const unredacted = current
    .replace(
      /\n\nconst zitadelZlib = require\("node:zlib"\);\n\n\/\* zitadel:proxy:exchange-redaction:v2 \*\/[\s\S]*?(?=\n\nfunction stripPrefix)/,
      "",
    )
    .replace(
      / {4}selfHandleResponse: true,\n[\s\S]*?\n {4}},\n(?= {2}},\n};)/,
      '    onProxyReq: setBearer,\n    configure: (proxy) => proxy.on("proxyReq", setBearer),\n',
    );
  if (unredacted.includes("exchange-redaction") || unredacted.includes("selfHandleResponse")) {
    throw new Error("expected the exchange redaction in the managed proxy");
  }
  return unredacted;
}

/**
 * The managed proxy as setup wrote it before it forwarded the app's origin:
 * `changeOrigin: false` kept the browser's `Host`, and with it `localhost` as
 * the TLS server name.
 */
function previousProxyConf(): string {
  const current = unredactedProxyConf();
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

    expect(proxyConfigEdit()(chosen)).toContain("    changeOrigin: false,\n    xfwd: false,\n");
  });

  it("handles the proxied responses itself, so it can redact the exchange", () => {
    const proxy = proxyConfigEdit()(undefined);

    expect(proxy).toContain("    selfHandleResponse: true,\n");
  });

  it("drops the session token from the exchange's body", () => {
    const proxy = proxyConfigEdit()(undefined);

    expect(proxy).toContain('const EXCHANGE_CREDENTIAL_FIELDS = ["session_token"];');
  });

  it("adds the redaction to the managed proxy it wrote without it", () => {
    const edit = proxyConfigEdit();

    expect(edit(unredactedProxyConf())).toBe(edit(undefined));
  });

  it("moves the redaction it wrote first onto the decoding one", () => {
    const edit = proxyConfigEdit();

    expect(edit(withFirstRedaction(edit(undefined)))).toBe(edit(undefined));
  });

  it("moves the request hook it wrote first onto the one that hands over the incoming request", () => {
    const edit = proxyConfigEdit();

    expect(edit(withFirstAngularRequestHook(withFirstRedaction(edit(undefined))))).toBe(
      edit(undefined),
    );
  });

  it("asks for an unencoded exchange answer through the request hook it wrote first", () => {
    const edit = proxyConfigEdit();
    const proxyReq = anExchangeRequest();

    entryOf(edit(withFirstAngularRequestHook(withFirstRedaction(edit(undefined))))).onProxyReq(
      proxyReq,
      {},
    );

    expect(proxyReq.headers["accept-encoding"]).toBe("identity");
  });

  it("asks for an unencoded exchange answer when a hook hands the helper no incoming request", () => {
    const proxyReq = anExchangeRequest();

    entryOf(withFirstAngularRequestHook(proxyConfigEdit()(undefined))).onProxyReq(proxyReq);

    expect(proxyReq.headers["accept-encoding"]).toBe("identity");
  });

  it("leaves a first redaction changed by hand alone", () => {
    const edit = proxyConfigEdit();
    const changed = withFirstRedaction(edit(undefined)).replace(
      "// Not JSON: an error page, say.",
      "// Not JSON: logged elsewhere.",
    );

    expect(edit(changed)).toBe(changed);
    expect(proxyConfigReview()(changed, "proxy.conf.cjs")).toContain("session_token");
  });

  it("keeps a managed proxy whose response handling was already chosen by hand", () => {
    const chosen = unredactedProxyConf().replace(
      "    onProxyReq: setBearer,\n",
      "    selfHandleResponse: false,\n    onProxyReq: setBearer,\n",
    );

    expect(proxyConfigEdit()(chosen)).toBe(chosen);
    expect(proxyConfigReview()(chosen, "proxy.conf.cjs")).toContain("selfHandleResponse");
  });

  it.each(["// }", 'note: "}",', "note: `}`,", "// {"])(
    "keeps a managed proxy whose response handling follows %s",
    (decoy) => {
      const chosen = unredactedProxyConf().replace(
        "    onProxyReq: setBearer,\n",
        `    ${decoy}\n    selfHandleResponse: false,\n    onProxyReq: setBearer,\n`,
      );

      expect(proxyConfigEdit()(chosen)).toBe(chosen);
    },
  );

  it("redacts only the /__nextgen entry when an earlier sibling copies the generated wiring", () => {
    const edit = proxyConfigEdit();
    const sibling = (source: string) =>
      source.replace(
        "module.exports = {\n",
        'module.exports = {\n  "/api": {\n    target: server,\n    onProxyReq: setBearer,\n    configure: (proxy) => proxy.on("proxyReq", setBearer),\n  },\n',
      );

    expect(edit(sibling(unredactedProxyConf()))).toBe(sibling(edit(undefined)));
  });

  it("keeps a managed proxy that hooks the proxy's responses itself", () => {
    const hooked = unredactedProxyConf().replace(
      "    onProxyReq: setBearer,\n",
      '    onProxyRes: (proxyRes) => delete proxyRes.headers["set-cookie"],\n    onProxyReq: setBearer,\n',
    );

    expect(proxyConfigEdit()(hooked)).toBe(hooked);
  });

  it.each(["cookieDomainRewrite", "cookiePathRewrite"])(
    "keeps a managed proxy that rewrites the cookies it relays with %s",
    (option) => {
      const rewriting = unredactedProxyConf().replace(
        "    onProxyReq: setBearer,\n",
        `    ${option}: "",\n    onProxyReq: setBearer,\n`,
      );

      expect(proxyConfigEdit()(rewriting)).toBe(rewriting);
    },
  );

  it("asks for review of a managed proxy left without the redaction by its own response hook", () => {
    const hooked = unredactedProxyConf().replace(
      "    onProxyReq: setBearer,\n",
      '    onProxyRes: (proxyRes) => delete proxyRes.headers["set-cookie"],\n    onProxyReq: setBearer,\n',
    );

    expect(proxyConfigReview()(proxyConfigEdit()(hooked), "proxy.conf.cjs")).toMatch(
      /proxy\.conf\.cjs.*session_token.*(own proxy hook|cookie rewrite)/,
    );
  });

  it.each(["cookieDomainRewrite", "cookiePathRewrite"])(
    "asks for review of a managed proxy left without the redaction by %s",
    (option) => {
      const rewriting = unredactedProxyConf()
        .replace("    onProxyReq: setBearer,\n", `    ${option}: "",\n    onProxyReq: setBearer,\n`)
        .replace(/\n/g, "\r\n");

      expect(proxyConfigReview()(rewriting, "proxy.conf.cjs")).toContain("session_token");
    },
  );

  it("asks for nothing when the managed proxy is redacted or unmanaged", () => {
    const review = proxyConfigReview();
    const hooked = unredactedProxyConf().replace(
      "    onProxyReq: setBearer,\n",
      "    onProxyRes: () => {},\n    onProxyReq: setBearer,\n",
    );

    expect(review(proxyConfigEdit()(unredactedProxyConf()), "proxy.conf.cjs")).toBeUndefined();
    expect(review(hooked.replace(`${MANAGED_MARKER}\n`, ""), "proxy.conf.cjs")).toBeUndefined();
  });

  it("adds the redaction to a managed proxy written with CRLF line endings", () => {
    const edit = proxyConfigEdit();

    const out = edit(unredactedProxyConf().replace(/\n/g, "\r\n"));

    expect(out).toBe(edit(undefined).replace(/\n/g, "\r\n"));
  });

  it("adds the redaction when a sibling proxy chose its own response handling", () => {
    const edit = proxyConfigEdit();
    const sibling = (source: string) =>
      source.replace(
        /\n\};\n$/,
        '\n  "/api": { target: server, selfHandleResponse: false },\n};\n',
      );

    expect(edit(sibling(unredactedProxyConf()))).toBe(sibling(edit(undefined)));
  });

  it("leaves an unmanaged proxy without the redaction alone", () => {
    const custom = unredactedProxyConf().replace(`${MANAGED_MARKER}\n`, "");

    expect(proxyConfigEdit()(custom)).toBe(custom);
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

const UNPARSEABLE_PATHS = ["/%5C%5B", "/%5C%5B/sessions/exchange"];

const UNREADABLE_NON_EXCHANGE_PATHS = ["/%E0%A4%A", "/%5B"];

const EXCHANGE_SPELLINGS = [
  "//sessions/exchange",
  "/./sessions/exchange",
  "/sessions//exchange",
  "/sessions/./exchange",
  "/sessions/exchange/",
  "/sessions/exchange?x=1",
  "/%73essions/exchange",
  "/sessions%2Fexchange",
  "/sessions/exchange%2F",
  "/x/../sessions/exchange",
  "/Sessions/Exchange",
  "/sessions/exchange;a=b",
];

interface FakeProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  getHeader(name: string): string | undefined;
  setHeader(name: string, value: string): void;
}

interface EntryHooks {
  onProxyReq(proxyReq: FakeProxyRequest, req?: object): void;
}

function anExchangeRequest(): FakeProxyRequest {
  const headers: Record<string, string> = {};
  return {
    method: "POST",
    path: "/sessions/exchange",
    headers,
    getHeader: (name) => headers[name],
    setHeader: (name, value) => {
      headers[name] = value;
    },
  };
}

/** The `/__nextgen` entry a generated `proxy.conf.cjs` exports, as the dev server's proxy layer calls it. */
function entryOf(proxyConf: string): EntryHooks {
  const exported: { exports: Record<string, EntryHooks> } = { exports: {} };
  runInNewContext(proxyConf, {
    module: exported,
    require: createRequire(import.meta.url),
    process: { env: { ZITADEL_URL: "https://zitadel.example.com", ZITADEL_PROJECT_SECRET: "sk" } },
    Buffer,
    URL,
  });
  const entry = exported.exports["/__nextgen"];
  if (!entry) {
    throw new Error("expected the generated proxy to export the /__nextgen entry");
  }
  return entry;
}

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

  it.each(EXCHANGE_SPELLINGS)(
    "keeps the session token out of an exchange spelled %s",
    async (tail) => {
      const { origin } = await serve(proxyConfigEdit()(undefined));

      const response = await fetch(`${origin}/__nextgen${tail}`, { method: "POST" });

      expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
    },
  );

  it.each(UNPARSEABLE_PATHS)(
    "keeps the session token out of an unparseable path %s",
    async (tail) => {
      const { origin } = await serve(proxyConfigEdit()(undefined));

      const response = await fetch(`${origin}/__nextgen${tail}`, { method: "POST" });
      const next = await fetch(`${origin}/__nextgen/healthz`);

      expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
      expect(next.status).toBe(200);
    },
  );

  it.each(UNREADABLE_NON_EXCHANGE_PATHS)(
    "survives a request for the malformed path %s",
    async (tail) => {
      const { origin } = await serve(proxyConfigEdit()(undefined));

      const response = await fetch(`${origin}/__nextgen${tail}`, { method: "POST" });
      const next = await fetch(`${origin}/__nextgen/healthz`);

      expect(response.status).toBe(200);
      expect(next.status).toBe(200);
    },
  );

  it("keeps the session token out of the exchange's body", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
  });

  it("sends the exchange's body with its own length", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(Number(response.headers.get("content-length"))).toBe(
      JSON.stringify({ session: EXCHANGE_BODY.session }).length,
    );
  });

  it("still delivers the session cookie with the exchange", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE]);
  });

  it("asks the server for an unencoded exchange answer", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(remote.requests.at(-1)?.headers["accept-encoding"]).toBe("identity");
  });

  it.each(["gzip", "br"])(
    "keeps the session token out of a %s-encoded exchange answer",
    async (encoding) => {
      const { origin } = await serve(proxyConfigEdit()(undefined));

      const response = await fetch(`${origin}/__nextgen/sessions/exchange?encoding=${encoding}`, {
        method: "POST",
      });

      expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
    },
  );

  it("answers 502 to an exchange answer it cannot decode", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?encoding=garbled`, {
      method: "POST",
    });

    expect(response.status).toBe(502);
  });

  it("never relays an exchange answer it cannot decode", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const body = await wireBodyOf(`${origin}/__nextgen/sessions/exchange?encoding=garbled`, "POST");

    expect(body).not.toContain(SESSION_TOKEN);
  });

  it("ends the browser's exchange request when the server drops it", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const delivery = await deliveryOf(`${origin}/__nextgen/sessions/exchange?abort`, "POST");

    expect(delivery).toBe("cut short");
  });

  it("ends the browser's other request when the server drops it", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const delivery = await deliveryOf(`${origin}/__nextgen/sessions/me?abort`);

    expect(delivery).toBe("cut short");
  });

  it("relays every other call's encoded body as the server sent it", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/me?encoding=gzip`);

    expect(await response.json()).toEqual(EXCHANGE_BODY);
  });

  it("handed the browser the session token in a gzip answer with the redaction it wrote first", async () => {
    const { origin } = await serve(withFirstRedaction(proxyConfigEdit()(undefined)));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?encoding=gzip`, {
      method: "POST",
    });

    expect(await response.json()).toEqual(EXCHANGE_BODY);
  });

  it("answers 502 to a successful exchange answer that is not JSON", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?as=text`, {
      method: "POST",
    });

    expect(response.status).toBe(502);
  });

  it("relays an error answer to the exchange that is not JSON as it came", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?as=text&status=503`, {
      method: "POST",
    });

    expect(await response.text()).toBe("ok");
  });

  it("keeps the session token out of an exchange body that starts with a byte order mark", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?bom`, { method: "POST" });

    expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
  });

  it("relays every other call's body as the server sent it", async () => {
    const { origin } = await serve(proxyConfigEdit()(undefined));

    const response = await fetch(`${origin}/__nextgen/sessions/me`);

    expect(await response.json()).toEqual(EXCHANGE_BODY);
  });

  it("handed the browser the session token with the proxy it wrote before", async () => {
    const { origin } = await serve(unredactedProxyConf());

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(await response.json()).toEqual(EXCHANGE_BODY);
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
