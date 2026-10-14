import { describe, expect, it } from "vitest";

import { nuxtConfigEdit } from "../../../../../../../src/lib/orca/patchers/rule/nuxt/nuxt-config";

const edit = nuxtConfigEdit();

describe("nuxtConfigEdit", () => {
  it("merges modules, nextgen, build, and vue into an empty config", () => {
    const out = edit("export default defineNuxtConfig({})");
    expect(out).toContain("@zitadel/sdk-nuxt/module");
    expect(out).toContain('loginPath: "/login"');
    expect(out).toContain('protectedRoutes: ["/profile"]');
    expect(out).toContain("@zitadel/components");
    expect(out).toContain("@zitadel/design-tokens");
    expect(out).toContain("isCustomElement");
    expect(out).toContain('tag.startsWith("zitadel-")');
  });

  it("leaves the backend URL and the project id to the module", () => {
    // The module reads ZITADEL_URL and NUXT_PUBLIC_ZITADEL_PROJECT_ID from the
    // environment or .env.local; a value in the config would override both.
    const out = edit("export default defineNuxtConfig({})");
    expect(out).not.toContain("url:");
    expect(out).not.toContain("runtimeConfig");
    expect(out).not.toContain("ZITADEL");
  });

  it("is idempotent — re-running over its own output changes nothing", () => {
    const once = edit("export default defineNuxtConfig({})");
    expect(edit(once)).toBe(once);
  });

  it("leaves a runtimeConfig it cannot edit alone", () => {
    const out = edit("export default defineNuxtConfig({ runtimeConfig: base })");
    expect(out).toContain("runtimeConfig: base");
    expect(out).toContain("@zitadel/sdk-nuxt/module");
  });

  it("throws E_VALIDATION when nextgen is not an inline object literal", () => {
    expect(() => edit("export default defineNuxtConfig({ nextgen: base })")).toThrowError(
      /E_VALIDATION|Could not edit/,
    );
  });

  it("throws E_VALIDATION when the file is missing", () => {
    expect(() => edit(undefined)).toThrowError(/not found/);
  });
});
