import { describe, expect, it } from "vitest";

import { nuxtConfigEdit } from "../../../../../../../src/lib/orca/patchers/rule/nuxt/nuxt-config";

const edit = nuxtConfigEdit({ projectId: "proj-1", server: "http://127.0.0.1:8080" });

describe("nuxtConfigEdit", () => {
  it("merges modules, nextgen, runtimeConfig, and build into an empty config", () => {
    const out = edit("export default defineNuxtConfig({})");
    expect(out).toContain("@zitadel/sdk-nuxt/module");
    expect(out).toContain('loginPath: "/login"');
    expect(out).toContain('nextgenProxyPath: "/__nextgen"');
    expect(out).toContain("process.env.ZITADEL_URL");
    expect(out).toContain("process.env.NUXT_PUBLIC_ZITADEL_PROJECT_ID");
    expect(out).toContain("@zitadel/components");
  });

  it("is idempotent — re-running over its own output changes nothing", () => {
    const once = edit("export default defineNuxtConfig({})");
    expect(edit(once)).toBe(once);
  });

  it("throws E_VALIDATION when runtimeConfig is not an inline object literal", () => {
    expect(() => edit("export default defineNuxtConfig({ runtimeConfig: base })")).toThrowError(
      /E_VALIDATION|Could not edit/,
    );
  });

  it("throws E_VALIDATION when the file is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });
});
