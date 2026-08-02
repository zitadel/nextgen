import { describe, expect, it } from "vitest";

import { viteProxyEdit } from "../../../../../../src/lib/orca/patchers/rule/vite-support";

const edit = viteProxyEdit(5173, "http://127.0.0.1:8099");

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
    // Bind the exact issuer port or fail — never drift to a port not in previewOrigins.
    expect(out).toContain("strictPort: true");
    expect(out).toContain("changeOrigin: false");
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
});`;

    const out = edit(legacy);

    expect(out).toContain("zitadel:proxy:v2");
    expect(out).toContain('pathname === "/sessions/exchange"');
    expect(out).toContain("http://127.0.0.1:8099");
    expect(out).not.toContain("http://old.example");
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
