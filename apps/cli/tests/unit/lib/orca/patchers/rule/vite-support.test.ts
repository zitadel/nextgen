import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { viteProxyEdit } from "../../../../../../src/lib/orca/patchers/rule/vite-support";
import { withFirstRedaction } from "../../../../../helpers/legacy-proxy";
import {
  EXCHANGE_BODY,
  REMOTE_HOST,
  SESSION_COOKIE,
  SESSION_TOKEN,
  useRemoteServer,
} from "../../../../../helpers/remote-server";
import { aViteApp, type DevApp, deliveryOf, wireBodyOf } from "../../../../../helpers/vite";

const edit = viteProxyEdit(5173, "http://127.0.0.1:8099");

const BARE_CONFIG = 'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n';

/**
 * What setup wrote into {@link BARE_CONFIG} before the proxy forwarded the
 * app's origin: `changeOrigin: false` kept the browser's `Host`, and with it
 * `localhost` as the TLS server name.
 */
const PREVIOUS_CONFIG = `import {defineConfig, loadEnv} from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,

    proxy: {
      "/__nextgen": /* zitadel:proxy:v2 */ {
        target: "https://zitadel.example.com",
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\\/__nextgen/, "").replace(/^(?!\\/)/, "/"),

        configure: (proxy) => {
          const secret = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET;
          if (!secret) {
            throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).");
          }
          const bearer = \`Bearer \${secret}\`;
          proxy.on("proxyReq", (proxyReq) => {
            const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
            if (
              proxyReq.method === "POST" &&
              pathname === "/sessions/exchange" &&
              !proxyReq.getHeader("authorization")
            ) {
              proxyReq.setHeader("authorization", bearer);
            }
          });
        }
      }
    }
  }
});
`;

/**
 * What setup wrote into {@link BARE_CONFIG} before the proxy kept the session
 * token out of the browser: it forwarded the app's origin, but relayed every
 * response body as the server sent it.
 */
const UNREDACTED_CONFIG = PREVIOUS_CONFIG.replace(
  "changeOrigin: false,",
  "changeOrigin: true,\n        xfwd: true,",
);

describe("viteProxyEdit", () => {
  it("adds the /__nextgen proxy with an exchange-only project-secret bearer", () => {
    const out = edit('import { defineConfig } from "vite";\nexport default defineConfig({});');
    expect(out).toContain("/__nextgen");
    expect(out).toContain("loadEnv");
    expect(out).toContain("ZITADEL_PROJECT_SECRET");
    expect(out).toContain("Bearer ${secret}");
    expect(out).toContain('proxyReq.method === "POST"');
    expect(out).toContain('pathname === "/sessions/exchange"');
    expect(out).toContain('!proxyReq.getHeader("authorization")');
    expect(out).toContain("zitadel:proxy:v2");
    expect(out).toContain("http://127.0.0.1:8099");
    expect(out).toContain("5173");
    // Bind the exact issuer port or fail — never drift to a port not in preview_origins.
    expect(out).toContain("strictPort: true");
    // The backend by its own name, the app's origin in X-Forwarded-*.
    expect(out).toContain("changeOrigin: true");
    expect(out).toContain("xfwd: true");
    // The bearer comes from .env.local via Vite's loadEnv, never from the
    // gitignored secret file directly.
    expect(out).not.toContain("readFileSync");
    expect(out).not.toContain(".zitadel/secret");
    // Sanity: the project_id fallback the SDKs used to send is gone.
    expect(out).not.toContain("Bearer sk_${projectId}");
  });

  it("preserves the user's existing plugins", () => {
    const out = edit("export default defineConfig({ plugins: [react()] });");
    expect(out).toContain("react()");
    expect(out).toContain("/__nextgen");
  });

  it("does not override a pre-set server.port", () => {
    const out = edit("export default defineConfig({ server: { port: 4000 } });");
    expect(out).toContain("4000");
    expect(out).not.toContain("5173");
  });

  it("leaves server.host unset so the user can opt into network binding", () => {
    const out = edit("export default defineConfig({});");
    expect(out).not.toContain("host:");
  });

  it("is idempotent — re-running over its own output changes nothing", () => {
    const once = edit("export default defineConfig({});");
    expect(edit(once)).toBe(once);
  });

  it("migrates the legacy generated proxy that stamped the secret on every request", () => {
    const legacy = `import { defineConfig, loadEnv } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/__nextgen": {
        target: "http://old.example",
        changeOrigin: false,
        secure: false,
        rewrite: (path) => path.slice("/__nextgen".length),
        configure: (proxy) => {
          const secret = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET;
          if (!secret) {
            throw new Error("ZITADEL_PROJECT_SECRET is not set; add it to .env.local (zitadel setup writes it).")
          }
          const bearer = \`Bearer \${secret}\`;
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("authorization", bearer);
          });
        },
      },
    },
  },
});
// preserved user note`;

    const out = edit(legacy);

    expect(out).toContain("zitadel:proxy:v2");
    expect(out).toContain('pathname === "/sessions/exchange"');
    expect(out).toContain("http://old.example");
    expect(out).toContain("changeOrigin: true,\n        xfwd: true,");
    expect(out).toContain("secure: false");
    expect(out).toContain("// preserved user note");
    expect(out).not.toContain("http://127.0.0.1:8099");
  });

  it("moves the entry it wrote before onto the origin-forwarding shape", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    expect(edit(PREVIOUS_CONFIG)).toBe(current);
  });

  it("handles the proxied responses itself, so it can redact the exchange", () => {
    const out = edit(BARE_CONFIG);

    expect(out).toContain("selfHandleResponse: true,");
  });

  it("drops the session token from the exchange's body", () => {
    const out = edit(BARE_CONFIG);

    expect(out).toContain('const EXCHANGE_CREDENTIAL_FIELDS = ["session_token"];');
  });

  it("adds the redaction to the entry it wrote without it", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    expect(edit(UNREDACTED_CONFIG)).toBe(current);
  });

  it("adds the redaction to an entry written with CRLF line endings", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    expect(edit(UNREDACTED_CONFIG.replace(/\n/g, "\r\n")).replace(/\r\n/g, "\n")).toBe(current);
  });

  it("moves the redaction it wrote first onto the decoding one", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    expect(edit(withFirstRedaction(current))).toBe(current);
  });

  it("moves a first redaction written with CRLF line endings onto the decoding one", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);
    const crlf = withFirstRedaction(current).replace(/\n/g, "\r\n");

    expect(edit(crlf)).toContain("zitadel:proxy:exchange-redaction:v2");
  });

  it("leaves a first redaction changed by hand alone", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);
    const changed = withFirstRedaction(current).replace(
      "// Not JSON: an error page, say.",
      "// Not JSON: logged elsewhere.",
    );

    expect(edit(changed)).toBe(changed);
  });

  it("keeps a generated entry whose response handling was already chosen by hand", () => {
    const chosen = UNREDACTED_CONFIG.replace(
      "xfwd: true,",
      "xfwd: true,\n        selfHandleResponse: false,",
    );

    expect(edit(chosen)).toBe(chosen);
  });

  it.each(["// }", 'note: "}",', "note: `}`,", "// {"])(
    "keeps a generated entry whose response handling follows %s",
    (decoy) => {
      const chosen = UNREDACTED_CONFIG.replace(
        "xfwd: true,",
        `xfwd: true,\n        ${decoy}\n        selfHandleResponse: false,`,
      );

      expect(edit(chosen)).toBe(chosen);
    },
  );

  it("redacts only the /__nextgen entry when an earlier sibling copies the generated listener", () => {
    const listener =
      /^ {10}proxy\.on\("proxyReq", \(proxyReq\) => \{\n[\s\S]*?\n {10}\}\);$/m.exec(
        UNREDACTED_CONFIG,
      )?.[0] ?? "";
    const sibling = `"/api": {\n        target: "http://localhost:9",\n        configure: (proxy) => {\n${listener}\n        },\n      },\n      `;
    const insert = (source: string) =>
      source.replace('proxy: {\n      "/__nextgen"', `proxy: {\n      ${sibling}"/__nextgen"`);
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    expect(listener).toContain("proxyReq.setHeader");
    expect(edit(insert(UNREDACTED_CONFIG))).toBe(insert(current));
  });

  it("adds the redaction when a sibling proxy chose its own response handling", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);
    const sibling = UNREDACTED_CONFIG.replace(
      'proxy: {\n      "/__nextgen"',
      'proxy: {\n      "/api": { target: "http://localhost:9", selfHandleResponse: true },\n      "/__nextgen"',
    );

    const out = edit(sibling);

    expect(out).toBe(
      current.replace(
        'proxy: {\n      "/__nextgen"',
        'proxy: {\n      "/api": { target: "http://localhost:9", selfHandleResponse: true },\n      "/__nextgen"',
      ),
    );
  });

  it("redacts the dev server's entry when a preview copy of the old entry comes first", () => {
    const entry = /"\/__nextgen": [\s\S]*?\n {6}\}\n/.exec(UNREDACTED_CONFIG)?.[0] ?? "";
    const preview = `  preview: {\n    proxy: {\n      ${entry}    },\n  },\n`;
    const both = UNREDACTED_CONFIG.replace("  server: {", `${preview}  server: {`);

    const [previewPart = "", serverPart = ""] = edit(both).split("  server: {");

    expect(previewPart.slice(previewPart.indexOf("  preview: {"))).toBe(
      both.slice(both.indexOf("  preview: {"), both.indexOf("  server: {")),
    );
    expect(serverPart).toContain("selfHandleResponse: true,");
    expect(serverPart).toContain("zitadel:proxy:exchange-redaction:v2");
    expect(edit(both)).toMatch(/^import zitadelZlib from "node:zlib";$/m);
  });

  it("keeps a generated entry that hooks the proxy's responses itself", () => {
    const hooked = UNREDACTED_CONFIG.replace(
      "        configure: (proxy) => {",
      '        configure: (proxy) => {\n          proxy.on("proxyRes", (proxyRes) => { delete proxyRes.headers["set-cookie"]; });',
    );

    expect(edit(hooked)).toBe(hooked);
  });

  it.each(["cookieDomainRewrite", "cookiePathRewrite"])(
    "keeps a generated entry that rewrites the cookies it relays with %s",
    (option) => {
      const rewriting = UNREDACTED_CONFIG.replace(
        "xfwd: true,",
        `xfwd: true,\n        ${option}: "",`,
      );

      expect(edit(rewriting)).toBe(rewriting);
    },
  );

  it("keeps the config's own zlib import and adds the redaction's under its own name", () => {
    const own = 'import zlib from "zlib";\n';

    const out = edit(own + BARE_CONFIG);

    expect(out.match(/^import zlib from "zlib";$/gm)).toHaveLength(1);
    expect(out.match(/^import \w+ from "node:zlib";$/gm)).toHaveLength(1);
    expect(out).not.toMatch(/^import zlib from "node:zlib";$/m);
  });

  it("adds the redaction beside a config's own zlib import to an entry written without it", () => {
    const out = edit(`import zlib from "zlib";\n${UNREDACTED_CONFIG}`);

    const names = [...out.matchAll(/^import (?:\{[^}]*\}|\w+) from/gm)].map((m) => m[0]);
    expect(new Set(names).size).toBe(names.length);
    expect(out).toContain("selfHandleResponse: true,");
  });

  it("emits helpers a TypeScript config can typecheck under noImplicitAny", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zitadel-typed-"));
    try {
      await symlink(join(process.cwd(), "node_modules"), join(dir, "node_modules"), "dir");
      const file = join(dir, "vite.config.ts");
      await writeFile(file, edit(BARE_CONFIG, file));
      const program = ts.createProgram([file], {
        noEmit: true,
        strict: true,
        noImplicitAny: true,
        skipLibCheck: true,
        esModuleInterop: true,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2023,
        lib: ["lib.es2023.d.ts"],
        types: ["node"],
      });

      const messages = ts
        .getPreEmitDiagnostics(program)
        .filter((diagnostic) => diagnostic.file?.fileName === file)
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));

      expect(messages).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the helpers plain JavaScript for a config that is not TypeScript", () => {
    expect(edit(BARE_CONFIG, "vite.config.js")).toContain("function isExchange(method, url) {");
  });

  it("leaves a generated entry whose bearer listener was changed by hand alone", () => {
    const changed = UNREDACTED_CONFIG.replace(
      'proxyReq.setHeader("authorization", bearer);',
      'proxyReq.setHeader("authorization", bearer);\n              console.debug("exchange");',
    );

    expect(edit(changed)).toBe(changed);
  });

  it("leaves a hand-written entry that keeps the browser's Host alone", () => {
    const custom = `export default defineConfig({
  server: {
    proxy: {
      "/__nextgen": {
        target: "https://custom.example",
        changeOrigin: false,
      },
    },
  },
});
`;

    const out = edit(custom);

    expect(out).toContain("changeOrigin: false");
    expect(out).not.toContain("xfwd");
  });

  it("keeps a generated entry whose forwarding was already chosen by hand", () => {
    const chosen = PREVIOUS_CONFIG.replace(
      "changeOrigin: false,",
      "changeOrigin: false,\n        xfwd: false,",
    );

    expect(edit(chosen)).toContain("changeOrigin: false,\n        xfwd: false,");
  });

  it("flags an unguarded write even when a v2 marker and decoy guard remain", () => {
    const reformattedLegacy = `import { defineConfig, loadEnv } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/__nextgen": {
        target: "http://old.example",
        configure(proxy) {
          const secret = loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_SECRET;
          const bearer = \`Bearer \${secret}\`;
          /* zitadel:proxy:v2 */
          proxy.on("proxyReq", (proxyReq) => {
            const pathname = new URL(proxyReq.path, "http://zitadel.local").pathname;
            if (
              proxyReq.method === "POST" &&
              pathname === "/sessions/exchange" &&
              !proxyReq.getHeader("authorization")
            ) {
              console.debug("exchange request");
            }
            proxyReq.setHeader("Authorization", bearer);
          });
        },
      },
    },
  },
});`;

    expect(() => edit(reformattedLegacy)).toThrowError(
      /may forward ZITADEL_PROJECT_SECRET outside POST \/sessions\/exchange/,
    );
  });

  it("preserves a custom existing /__nextgen proxy", () => {
    const custom = `export default defineConfig({
  server: { proxy: { "/__nextgen": { target: "https://custom.example" } } },
});`;

    const out = edit(custom);

    expect(out).toContain("https://custom.example");
    expect(out).not.toContain("zitadel:proxy:v2");
    expect(out).not.toContain("ZITADEL_PROJECT_SECRET");
  });

  it("throws E_VALIDATION when the config is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });
});

describe("the generated proxy, run by Vite against a remote https server", () => {
  const remote = useRemoteServer();
  const env = { ZITADEL_PROJECT_SECRET: "sk_proj_test" };
  let app: DevApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function serve(config: string): Promise<DevApp> {
    app = await aViteApp(config, env);
    return app;
  }

  it("reaches the server by its own name", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/healthz`);

    expect(response.status).toBe(200);
    expect(remote.requests.at(-1)).toMatchObject({
      path: "/healthz",
      servername: REMOTE_HOST,
      headers: { host: new URL(remote.url).host },
    });
  });

  it("tells the server the app's origin", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    await fetch(`${origin}/__nextgen/healthz`);

    expect(remote.requests.at(-1)?.headers).toMatchObject({
      "x-forwarded-host": new URL(origin).host,
      "x-forwarded-proto": "http",
    });
  });

  it("attaches the project secret to the session exchange only", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });
    await fetch(`${origin}/__nextgen/sessions/me`);

    const [exchange, me] = remote.requests.slice(-2);
    expect(exchange?.headers.authorization).toBe("Bearer sk_proj_test");
    expect(me?.headers.authorization).toBeUndefined();
  });

  it("keeps the session token out of the exchange's body", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
  });

  it("sends the exchange's body with its own length", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(Number(response.headers.get("content-length"))).toBe(
      JSON.stringify({ session: EXCHANGE_BODY.session }).length,
    );
  });

  it("still delivers the session cookie with the exchange", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(response.headers.getSetCookie()).toEqual([SESSION_COOKIE]);
  });

  it("asks the server for an unencoded exchange answer", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(remote.requests.at(-1)?.headers["accept-encoding"]).toBe("identity");
  });

  it.each(["gzip", "br"])(
    "keeps the session token out of a %s-encoded exchange answer",
    async (encoding) => {
      const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

      const response = await fetch(`${origin}/__nextgen/sessions/exchange?encoding=${encoding}`, {
        method: "POST",
      });

      expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
    },
  );

  it("answers 502 to an exchange answer it cannot decode", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?encoding=garbled`, {
      method: "POST",
    });

    expect(response.status).toBe(502);
  });

  it("never relays an exchange answer it cannot decode", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const body = await wireBodyOf(`${origin}/__nextgen/sessions/exchange?encoding=garbled`, "POST");

    expect(body).not.toContain(SESSION_TOKEN);
  });

  it("ends the browser's exchange request when the server drops it", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const delivery = await deliveryOf(`${origin}/__nextgen/sessions/exchange?abort`, "POST");

    expect(delivery).toBe("cut short");
  });

  it("ends the browser's other request when the server drops it", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const delivery = await deliveryOf(`${origin}/__nextgen/sessions/me?abort`);

    expect(delivery).toBe("cut short");
  });

  it("relays every other call's encoded body as the server sent it", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/me?encoding=gzip`);

    expect(await response.json()).toEqual(EXCHANGE_BODY);
  });

  it("handed the browser the session token in a gzip answer with the redaction it wrote first", async () => {
    const { origin } = await serve(
      withFirstRedaction(viteProxyEdit(5173, remote.url)(BARE_CONFIG)),
    );

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?encoding=gzip`, {
      method: "POST",
    });

    expect(await response.json()).toEqual(EXCHANGE_BODY);
  });

  it("answers 502 to a successful exchange answer that is not JSON", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?as=text`, {
      method: "POST",
    });

    expect(response.status).toBe(502);
  });

  it("relays an error answer to the exchange that is not JSON as it came", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?as=text&status=503`, {
      method: "POST",
    });

    expect(await response.text()).toBe("ok");
  });

  it("keeps the session token out of an exchange body that starts with a byte order mark", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/exchange?bom`, { method: "POST" });

    expect(await response.json()).toEqual({ session: EXCHANGE_BODY.session });
  });

  it("relays every other call's body as the server sent it", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    const response = await fetch(`${origin}/__nextgen/sessions/me`);

    expect(await response.json()).toEqual(EXCHANGE_BODY);
  });

  it("handed the browser the session token with the entry it wrote before", async () => {
    const { origin } = await serve(
      UNREDACTED_CONFIG.replace("https://zitadel.example.com", remote.url),
    );

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(await response.json()).toEqual(EXCHANGE_BODY);
  });

  it("could not reach it with the entry it wrote before", async () => {
    const { origin } = await serve(
      PREVIOUS_CONFIG.replace("https://zitadel.example.com", remote.url),
    );
    const reached = remote.requests.length;

    const response = await fetch(`${origin}/__nextgen/healthz`);

    expect(response.ok).toBe(false);
    expect(remote.requests).toHaveLength(reached);
  });
});
