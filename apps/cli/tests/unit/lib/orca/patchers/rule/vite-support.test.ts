import { afterEach, describe, expect, it } from "vitest";

import { SESSION_COOKIE_MARKER } from "../../../../../../src/lib/orca/patchers/rule/session-cookie";
import {
  viteProxyEdit,
  viteSessionCookieEdit,
} from "../../../../../../src/lib/orca/patchers/rule/vite-support";
import { REMOTE_HOST, useRemoteServer } from "../../../../../helpers/remote-server";
import { aViteApp, type DevApp } from "../../../../../helpers/vite";

const edit = viteProxyEdit(5173, "http://127.0.0.1:8099");
const sessionCookieEdit = viteSessionCookieEdit();

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

  it("keeps the app's session cookie under its project's name", () => {
    const out = edit("export default defineConfig({});");

    expect(out).toContain(SESSION_COOKIE_MARKER);
    expect(out).toContain('loadEnv("development", process.cwd(), "ZITADEL_").ZITADEL_PROJECT_ID');
    expect(out).toContain(
      'proxy.on("proxyRes", (proxyRes) => renameSessionCookie(proxyRes, appCookie));',
    );
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

    // As setup applies them: the entry's edit, then its session-cookie hooks.
    expect(sessionCookieEdit(edit(PREVIOUS_CONFIG))).toBe(current);
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

describe("viteSessionCookieEdit", () => {
  /** What setup wrote before the entry carried the session-cookie hooks. */
  const bearerOnly = edit(PREVIOUS_CONFIG);

  it("gives the entry it wrote before the session-cookie hooks", () => {
    const current = viteProxyEdit(5173, "https://zitadel.example.com")(BARE_CONFIG);

    expect(sessionCookieEdit(bearerOnly)).toBe(current);
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
