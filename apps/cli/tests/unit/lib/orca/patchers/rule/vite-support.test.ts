import { describe, expect, it } from "vitest";

import { viteProxyEdit } from "../../../../../../src/lib/orca/patchers/rule/vite-support";

const edit = viteProxyEdit(5173);

describe("viteProxyEdit", () => {
  it("adds the /__nextgen proxy, the readFileSync import, and the derived port", () => {
    const out = edit('import { defineConfig } from "vite";\nexport default defineConfig({});');
    expect(out).toContain("/__nextgen");
    expect(out).toContain("readFileSync");
    expect(out).toContain("5173");
    // Must NOT rewrite the Host header — the backend's origin check reads it.
    expect(out).not.toContain("changeOrigin: true");
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
