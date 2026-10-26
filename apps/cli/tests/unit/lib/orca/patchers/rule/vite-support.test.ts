import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE_MARKER } from "../../../../../../src/lib/orca/patchers/rule/session-cookie";
import {
  viteApiPrefixEdit,
  viteApiPrefixVerdict,
  viteProxyEdit,
  viteSessionCookieEdit,
  viteSessionCookieVerdict,
} from "../../../../../../src/lib/orca/patchers/rule/vite-support";
import { REMOTE_HOST, useRemoteServer } from "../../../../../helpers/remote-server";
import { aViteApp, type DevApp } from "../../../../../helpers/vite";

const edit = viteProxyEdit(5173, "http://127.0.0.1:8099");
const sessionCookieEdit = viteSessionCookieEdit();
const apiPrefixEdit = viteApiPrefixEdit();

/** The path check of the bearer hook setup writes: the exchange with and without the API prefix. */
const BOTH_EXCHANGE_PATHS =
  '(pathname === "/sessions/exchange" || pathname === "/api/v1/sessions/exchange")';

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

/** What setup wrote before it held the bearer to the exchange: the secret went with every request. */
const UNCONDITIONAL_BEARER_CONFIG = `import { defineConfig, loadEnv } from "vite";
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

describe("viteProxyEdit", () => {
  it("adds the /__nextgen proxy with an exchange-only project-secret bearer", () => {
    const out = edit('import { defineConfig } from "vite";\nexport default defineConfig({});');
    expect(out).toContain("/__nextgen");
    expect(out).toContain("loadEnv");
    expect(out).toContain("ZITADEL_PROJECT_SECRET");
    expect(out).toContain("Bearer ${secret}");
    expect(out).toContain('proxyReq.method === "POST"');
    expect(out).toContain(BOTH_EXCHANGE_PATHS);
    expect(out).toContain('!proxyReq.getHeader("authorization")');
    expect(out).toContain("zitadel:proxy:v3");
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

  it("moves a server.port still on the port the app is moving off", () => {
    const move = viteProxyEdit(5180, "http://127.0.0.1:8099", 5173);
    const out = move("export default defineConfig({ server: { port: 5173 } });");
    expect(out).toContain("5180");
    expect(out).not.toContain("5173");
  });

  it("keeps a server.port the app is not moving off", () => {
    const move = viteProxyEdit(5180, "http://127.0.0.1:8099", 5173);
    const out = move("export default defineConfig({ server: { port: 4000 } });");
    expect(out).toContain("4000");
    expect(out).not.toContain("5180");
  });

  it("leaves server.host unset so the user can opt into network binding", () => {
    const out = edit("export default defineConfig({});");
    expect(out).not.toContain("host:");
  });

  it("keeps the app's session cookie under its project's name", () => {
    const out = edit("export default defineConfig({});");

    expect(out).toContain(SESSION_COOKIE_MARKER);
    expect(out).toContain('loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_ID');
    // The listeners themselves, so Vite's types reach their parameters.
    expect(out).toContain('proxy.on("proxyRes", (proxyRes) => {');
    expect(out).not.toMatch(/function \w+\(/);
  });

  it("is idempotent — re-running over its own output changes nothing", () => {
    const once = edit("export default defineConfig({});");
    expect(edit(once)).toBe(once);
  });

  it("migrates the legacy generated proxy that stamped the secret on every request", () => {
    const legacy = UNCONDITIONAL_BEARER_CONFIG;

    const out = edit(legacy);

    expect(out).toContain("zitadel:proxy:v3");
    expect(out).toContain(BOTH_EXCHANGE_PATHS);
    expect(out).toContain("http://old.example");
    expect(out).toContain("changeOrigin: true,\n        xfwd: true,");
    expect(out).toContain("secure: false");
    expect(out).toContain("// preserved user note");
    expect(out).not.toContain("http://127.0.0.1:8099");
  });

  it("moves the entry it wrote before onto the origin-forwarding shape", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    // As setup applies them: the entry's edit, its session-cookie hooks, then
    // the exchange under the API prefix.
    expect(apiPrefixEdit(sessionCookieEdit(edit(PREVIOUS_CONFIG)))).toBe(current);
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

    expect(edit(chosen)).toBe(chosen);
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

  it("flags a guard that an `||` widens beyond the exchange", () => {
    const widened = edit(BARE_CONFIG).replace(
      BOTH_EXCHANGE_PATHS,
      'pathname === "/sessions/exchange" || true',
    );

    expect(() => edit(widened)).toThrowError(
      /may forward ZITADEL_PROJECT_SECRET outside POST \/sessions\/exchange/,
    );
  });

  it("accepts a guard that names the two exchange paths in either order", () => {
    const swapped = edit(BARE_CONFIG).replace(
      BOTH_EXCHANGE_PATHS,
      '(pathname === "/api/v1/sessions/exchange" || pathname === "/sessions/exchange")',
    );

    expect(edit(swapped)).toBe(swapped);
  });

  it("flags a guard that names another path beside the exchange", () => {
    const other = edit(BARE_CONFIG).replace(
      BOTH_EXCHANGE_PATHS,
      '(pathname === "/sessions/exchange" || pathname === "/users/me")',
    );

    expect(() => edit(other)).toThrowError(
      /may forward ZITADEL_PROJECT_SECRET outside POST \/sessions\/exchange/,
    );
  });

  it("preserves a custom existing /__nextgen proxy", () => {
    const custom = `export default defineConfig({
  server: { proxy: { "/__nextgen": { target: "https://custom.example" } } },
});`;

    const out = edit(custom);

    expect(out).toContain("https://custom.example");
    expect(out).not.toContain("zitadel:proxy:");
    expect(out).not.toContain("ZITADEL_PROJECT_SECRET");
  });

  it("throws E_VALIDATION when the config is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });
});

describe("viteSessionCookieEdit", () => {
  /** What setup wrote before the entry carried the session-cookie hooks. */
  const bearerOnly = edit(PREVIOUS_CONFIG);

  it("gives the entry it wrote before the session-cookie hooks", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    expect(apiPrefixEdit(sessionCookieEdit(bearerOnly))).toBe(current);
  });

  it("finds the entry it wrote whatever a formatter did to its layout", () => {
    const tabbed = bearerOnly.replace(/^(?: {2})+/gm, (spaces) => "\t".repeat(spaces.length / 2));

    const out = sessionCookieEdit(tabbed);

    expect(out).toContain(`\t\t\t\t\t/* ${SESSION_COOKIE_MARKER} */`);
    expect(out.indexOf('proxyReq.setHeader("authorization", bearer);')).toBeLessThan(
      out.indexOf(SESSION_COOKIE_MARKER),
    );
    expect(sessionCookieEdit(out)).toBe(out);
  });

  it("also gives the entry it migrated from the unconditional bearer the hooks", () => {
    const legacy = `import { defineConfig, loadEnv } from "vite";
export default defineConfig({
  server: {
    proxy: {
      "/__nextgen": {
        target: "http://old.example",
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

    const out = sessionCookieEdit(edit(legacy));

    expect(out).toContain(SESSION_COOKIE_MARKER);
    expect(out).toContain("http://old.example");
    expect(out).toContain("// preserved user note");
  });

  it("leaves a hand-written entry alone", () => {
    const custom = `export default defineConfig({
  server: { proxy: { "/__nextgen": { target: "https://custom.example" } } },
});`;

    expect(sessionCookieEdit(custom)).toBe(custom);
  });

  it("leaves an entry whose bearer hook was changed alone", () => {
    const changed = bearerOnly.replace(
      'proxyReq.setHeader("authorization", bearer);',
      'proxyReq.setHeader("authorization", bearer);\n              console.debug("exchange");',
    );

    expect(sessionCookieEdit(changed)).toBe(changed);
  });

  it("is idempotent — an entry with the hooks is left as it is", () => {
    const current = edit(BARE_CONFIG);

    expect(sessionCookieEdit(current)).toBe(current);
  });

  it("throws E_VALIDATION when the config is missing", () => {
    expect(() => sessionCookieEdit(undefined)).toThrowError(/not found/);
  });

  // A config saved on Windows: the parser's offsets must index the text the
  // hooks are spliced into, or a statement after the bearer hook is cut apart.
  it("gives a CRLF config the hooks with CRLF line ends", () => {
    const withLogging = bearerOnly.replace(
      '              proxyReq.setHeader("authorization", bearer);\n            }\n          });',
      '              proxyReq.setHeader("authorization", bearer);\n            }\n          });\n          proxy.on("error", (error) => console.error("proxy", error));',
    );
    expect(withLogging).not.toBe(bearerOnly);
    const crlf = withLogging.replace(/\n/g, "\r\n");

    const out = sessionCookieEdit(crlf);

    expect(out).toBe(sessionCookieEdit(withLogging).replace(/\n/g, "\r\n"));
    expect(out).toContain('proxy.on("error", (error) => console.error("proxy", error));');
    expect(sessionCookieEdit(out)).toBe(out);
  });

  it("keeps a byte-order mark", () => {
    const out = sessionCookieEdit(`\uFEFF${bearerOnly}`);

    expect(out).toBe(`\uFEFF${sessionCookieEdit(bearerOnly)}`);
  });

  // What Prettier and Biome make of the generated hook: create-vue's Prettier
  // drops semicolons and arrow parentheses and uses single quotes.
  it.each([
    ["single quotes", (config: string) => config.replace(/"/g, "'")],
    ["no semicolons", (config: string) => config.replace(/;$/gm, "")],
    [
      "arrow parameters without parentheses",
      (config: string) => config.replace(/\((\w+)\) =>/g, "$1 =>"),
    ],
    [
      "create-vue's Prettier style",
      (config: string) =>
        config
          .replace(/"/g, "'")
          .replace(/;$/gm, "")
          .replace(/\((\w+)\) =>/g, "$1 =>"),
    ],
  ])("finds the entry it wrote in %s", (_label, format) => {
    const formatted = format(bearerOnly);
    expect(formatted).not.toBe(bearerOnly);

    const out = sessionCookieEdit(formatted);

    expect(viteSessionCookieVerdict(formatted)).toBe("detached");
    expect(out).toContain(SESSION_COOKIE_MARKER);
    expect(viteSessionCookieVerdict(out)).toBe("applied");
  });
});

describe("viteSessionCookieVerdict", () => {
  const bearerOnly = edit(PREVIOUS_CONFIG);

  it("reads a config with the hooks as applied", () => {
    expect(viteSessionCookieVerdict(edit(BARE_CONFIG))).toBe("applied");
  });

  it("reads the entry it wrote before the hooks as detached", () => {
    expect(viteSessionCookieVerdict(bearerOnly)).toBe("detached");
    expect(viteSessionCookieVerdict(bearerOnly.replace(/\n/g, "\r\n"))).toBe("detached");
  });

  it("reads a config without the CLI's entry as detached, since the proxy edit writes it with them", () => {
    expect(viteSessionCookieVerdict(BARE_CONFIG)).toBe("detached");
  });

  // The edit leaves such an entry as it is, so its output says nothing.
  it("does not read an entry whose bearer hook was changed as applied", () => {
    const changed = bearerOnly.replace(
      'proxyReq.setHeader("authorization", bearer);',
      'proxyReq.setHeader("authorization", bearer);\n              console.debug("exchange");',
    );

    expect(sessionCookieEdit(changed)).toBe(changed);
    expect(viteSessionCookieVerdict(changed)).toEqual({
      unknown: expect.stringContaining("must be added by hand"),
    });
  });
});

describe("viteApiPrefixEdit", () => {
  /** The entry setup wrote with the session-cookie hooks, before it knew the API prefix. */
  const v2 = sessionCookieEdit(edit(PREVIOUS_CONFIG));

  it("moves the v2 entry it wrote to the exchange with and without the API prefix", () => {
    const out = apiPrefixEdit(v2);

    expect(out).toContain(BOTH_EXCHANGE_PATHS);
    expect(out).toContain("/* zitadel:proxy:v3 */");
    expect(out).not.toContain("zitadel:proxy:v2");
    expect(out.replace(BOTH_EXCHANGE_PATHS, 'pathname === "/sessions/exchange"')).toBe(
      v2.replace("zitadel:proxy:v2", "zitadel:proxy:v3"),
    );
  });

  it("finds the v2 entry whatever a formatter did to its layout", () => {
    const reformatted = v2
      .replace(/"/g, "'")
      .replace(/;$/gm, "")
      .replace(/^(?: {2})+/gm, (spaces) => "\t".repeat(spaces.length / 2));

    const out = apiPrefixEdit(reformatted);

    expect(out).toContain(BOTH_EXCHANGE_PATHS);
    expect(out).toContain("zitadel:proxy:v3");
    expect(apiPrefixEdit(out)).toBe(out);
  });

  it("moves the hook a v2 setup migrated from the unconditional bearer as well", () => {
    const current = edit(UNCONDITIONAL_BEARER_CONFIG);
    // What a v2 setup made of it: its marker sits on the hook, inside the entry.
    const byV2 = current
      .replace("zitadel:proxy:v3", "zitadel:proxy:v2")
      .replace(BOTH_EXCHANGE_PATHS, 'pathname === "/sessions/exchange"');

    expect(apiPrefixEdit(byV2)).toBe(current);
  });

  it("leaves an entry whose bearer hook was changed alone", () => {
    const changed = v2.replace(
      'proxyReq.setHeader("authorization", bearer);',
      'proxyReq.setHeader("authorization", bearer);\n              console.debug("exchange");',
    );

    expect(apiPrefixEdit(changed)).toBe(changed);
  });

  it("leaves a hand-written entry alone", () => {
    const custom = `export default defineConfig({
  server: { proxy: { "/__nextgen": { target: "https://custom.example" } } },
});`;

    expect(apiPrefixEdit(custom)).toBe(custom);
  });

  it("is idempotent — the entry setup writes now is left as it is", () => {
    const current = sessionCookieEdit(edit(BARE_CONFIG));

    expect(apiPrefixEdit(current)).toBe(current);
  });

  it("moves a CRLF config with CRLF line ends", () => {
    const out = apiPrefixEdit(v2.replace(/\n/g, "\r\n"));

    expect(out).toBe(apiPrefixEdit(v2).replace(/\n/g, "\r\n"));
  });

  it("throws E_VALIDATION when the config is missing", () => {
    expect(() => apiPrefixEdit(undefined)).toThrowError(/not found/);
  });
});

describe("viteApiPrefixVerdict", () => {
  const v2 = sessionCookieEdit(edit(PREVIOUS_CONFIG));

  it("reads the entry setup writes now as applied", () => {
    expect(viteApiPrefixVerdict(sessionCookieEdit(edit(BARE_CONFIG)))).toBe("applied");
  });

  it("reads the v2 entry it wrote as detached", () => {
    expect(viteApiPrefixVerdict(v2)).toBe("detached");
    expect(viteApiPrefixVerdict(v2.replace(/\n/g, "\r\n"))).toBe("detached");
  });

  it("reads an entry whose bearer hook was changed as unknown, not applied", () => {
    const changed = v2.replace(
      'proxyReq.setHeader("authorization", bearer);',
      'proxyReq.setHeader("authorization", bearer);\n              console.debug("exchange");',
    );

    expect(viteApiPrefixVerdict(changed)).toEqual({
      unknown: expect.stringContaining("must accept /api/v1/sessions/exchange by hand"),
    });
  });

  it("reads a hand-written proxy that attaches the secret to the bare exchange only as unknown", () => {
    const custom = `export default defineConfig({
  server: { proxy: { "/__nextgen": { target: "https://custom.example", headers: { authorization: process.env.ZITADEL_PROJECT_SECRET } } } },
});`;

    expect(viteApiPrefixVerdict(custom)).toEqual({
      unknown: expect.stringContaining("not the one zitadel setup writes"),
    });
  });

  it("reads a config without a proxy that attaches the secret as applied", () => {
    expect(viteApiPrefixVerdict(BARE_CONFIG)).toBe("applied");
  });
});

/** The CLI package: a config checked from here resolves `vite` and `@types/node` as an app does. */
const CLI_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));

/**
 * The diagnostics of `source` checked as create-vite's TypeScript templates
 * check their `vite.config.ts` (`tsconfig.node.json`): strict, with no unused
 * locals or parameters.
 */
function strictDiagnostics(source: string): string[] {
  const file = join(CLI_ROOT, "vite.config.strict-check.ts");
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2023,
    lib: ["lib.es2023.d.ts"],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    moduleDetection: ts.ModuleDetectionKind.Force,
    types: ["node"],
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
  };
  const host = ts.createCompilerHost(options);
  const { fileExists, getSourceFile, readFile } = host;
  host.fileExists = (name) => name === file || fileExists.call(host, name);
  host.readFile = (name) => (name === file ? source : readFile.call(host, name));
  host.getSourceFile = (name, version, ...rest) =>
    name === file
      ? ts.createSourceFile(name, source, version)
      : getSourceFile.call(host, name, version, ...rest);
  const program = ts.createProgram([file], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

// `npm run build` of the react-ts, vue-ts, solid-ts and qwik-ts templates (and
// svelte-ts's `npm run check`) type-checks vite.config.ts this way.
describe("the generated vite.config.ts, type-checked as a create-vite TS template does", () => {
  it("type-checks as setup writes it", { timeout: 60_000 }, () => {
    expect(strictDiagnostics(sessionCookieEdit(edit(BARE_CONFIG)))).toEqual([]);
  });

  it("type-checks once doctor --fix gave the entry it wrote before the hooks", {
    timeout: 60_000,
  }, () => {
    const upgraded = sessionCookieEdit(edit(PREVIOUS_CONFIG));

    expect(upgraded).toContain(SESSION_COOKIE_MARKER);
    expect(strictDiagnostics(upgraded)).toEqual([]);
  });

  // Proves the check sees what a strict build sees.
  it("reports an untyped parameter", { timeout: 60_000 }, () => {
    const untyped = edit(BARE_CONFIG).replace(
      `/* ${SESSION_COOKIE_MARKER} */`,
      `/* ${SESSION_COOKIE_MARKER} */\n    function untyped(value) { return value; }\n    untyped(1);`,
    );

    expect(strictDiagnostics(untyped).join("\n")).toMatch(/implicitly has an 'any' type/);
  });
});

describe("the generated proxy, run by Vite against a remote https server", () => {
  const remote = useRemoteServer();
  const env = { ZITADEL_PROJECT_SECRET: "sk_proj_test" };
  /** An app whose `.env.local` names its project, as setup writes it. */
  const withProject = { ...env, ZITADEL_PROJECT_ID: "proj_spa" };
  let app: DevApp | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
    remote.answerWith(undefined);
  });

  async function serve(config: string, appEnv: Record<string, string> = env): Promise<DevApp> {
    app = await aViteApp(config, appEnv);
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

  it("attaches the project secret to the session exchange under the API prefix too", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG));

    await fetch(`${origin}/__nextgen/api/v1/sessions/exchange`, { method: "POST" });
    await fetch(`${origin}/__nextgen/api/v1/sessions/me`);

    const [exchange, me] = remote.requests.slice(-2);
    expect(exchange?.path).toBe("/api/v1/sessions/exchange");
    expect(exchange?.headers.authorization).toBe("Bearer sk_proj_test");
    expect(me?.headers.authorization).toBeUndefined();
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

  it("sends the app's session cookie to the server under the server's name", async () => {
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG), withProject);

    await fetch(`${origin}/__nextgen/users/me`, {
      headers: {
        cookie:
          "theme=dark; __nextgen_session=console; __nextgen_session_proj_other=other; __nextgen_session_proj_spa=mine",
      },
    });

    expect(remote.requests.at(-1)?.headers.cookie).toBe("theme=dark; __nextgen_session=mine");
  });

  it("keeps the session cookie the server sets under the app's project's name", async () => {
    remote.answerWith({
      "set-cookie": [
        "__nextgen_session=minted; Path=/; HttpOnly; SameSite=Lax",
        "_zflow=; Path=/; Max-Age=0",
      ],
    });
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG), withProject);

    const response = await fetch(`${origin}/__nextgen/sessions/exchange`, { method: "POST" });

    expect(response.headers.getSetCookie()).toEqual([
      "__nextgen_session_proj_spa=minted; Path=/; HttpOnly; SameSite=Lax",
      "_zflow=; Path=/; Max-Age=0",
    ]);
  });

  it("passes the cookies through when no project is configured", async () => {
    remote.answerWith({ "set-cookie": "__nextgen_session=minted; Path=/" });
    const { origin } = await serve(viteProxyEdit(5173, remote.url)(BARE_CONFIG), {
      ...env,
      ZITADEL_PROJECT_ID: "",
    });

    const response = await fetch(`${origin}/__nextgen/sessions/me`, {
      headers: { cookie: "__nextgen_session=tok" },
    });

    expect(remote.requests.at(-1)?.headers.cookie).toBe("__nextgen_session=tok");
    expect(response.headers.getSetCookie()).toEqual(["__nextgen_session=minted; Path=/"]);
  });

  it("keeps the session cookie per project once it gave the entry it wrote before the hooks", async () => {
    remote.answerWith({ "set-cookie": "__nextgen_session=minted; Path=/" });
    const previous = edit(PREVIOUS_CONFIG.replace("https://zitadel.example.com", remote.url));
    const { origin } = await serve(sessionCookieEdit(previous), withProject);

    const response = await fetch(`${origin}/__nextgen/users/me`, {
      headers: { cookie: "__nextgen_session=console; __nextgen_session_proj_spa=mine" },
    });

    expect(remote.requests.at(-1)?.headers.cookie).toBe("__nextgen_session=mine");
    expect(response.headers.getSetCookie()).toEqual(["__nextgen_session_proj_spa=minted; Path=/"]);
  });
});
