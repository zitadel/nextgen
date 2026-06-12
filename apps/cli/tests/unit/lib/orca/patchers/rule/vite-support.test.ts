import { describe, expect, it } from "vitest";

import { viteProxyEdit } from "../../../../../../src/lib/orca/patchers/rule/vite-support";

const edit = viteProxyEdit(5173, "http://127.0.0.1:8099");

describe("viteProxyEdit", () => {
  it("adds the /__nextgen proxy with the env-derived sk_ bearer and the backend target", () => {
    const out = edit('import { defineConfig } from "vite";\nexport default defineConfig({});');
    expect(out).toContain("/__nextgen");
    expect(out).toContain("loadEnv");
    expect(out).toContain("ZITADEL_PROJECT_ID");
    expect(out).toContain("Bearer sk_");
    expect(out).toContain("http://127.0.0.1:8099");
    expect(out).toContain("5173");
    expect(out).toContain("changeOrigin: false");
    // No file reads — the bearer comes from env, not the secret file.
    expect(out).not.toContain("readFileSync");
    expect(out).not.toContain(".zitadel/secret");
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

  it("is idempotent — re-running over its own output changes nothing", () => {
    const once = edit("export default defineConfig({});");
    expect(edit(once)).toBe(once);
  });

  it("throws E_VALIDATION when the config is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });
});
