import { describe, expect, it } from "vitest";

import { nuxtConfigEdit } from "../../../../../../../src/lib/orca/patchers/rule/nuxt/nuxt-config";

const edit = nuxtConfigEdit();

describe("nuxtConfigEdit", () => {
  it("merges modules, nextgen, and vue into an empty config", () => {
    const out = edit("export default defineNuxtConfig({})");
    expect(out).toContain("@zitadel/sdk-nuxt/module");
    expect(out).toContain('loginPath: "/login"');
    expect(out).toContain('protectedRoutes: ["/profile"]');
    expect(out).toContain("isCustomElement");
    expect(out).toContain('tag.startsWith("zitadel-")');
  });

  // The app goes through its SDK, which owns these packages as its own
  // dependencies, so the generated config mentions none of them.
  it.each(["@zitadel/api", "@zitadel/components", "@zitadel/design-tokens"])(
    "never mentions %s",
    (name) => {
      const out = edit("export default defineNuxtConfig({})");
      expect(out).not.toContain(name);
      expect(out).not.toContain("transpile");
    },
  );

  // Apps scaffolded earlier carry `build.transpile` entries. The wiring probes
  // (verify, doctor, eject) treat a config as in sync when the edit returns it
  // unchanged, so those entries must neither be stripped nor flagged as drift.
  it("recognises a config an earlier version wrote, entries and all", () => {
    const earlier = `export default defineNuxtConfig({
  modules: ["@zitadel/sdk-nuxt/module"],
  nextgen: { loginPath: "/login", protectedRoutes: ["/profile"] },
  build: { transpile: ["@zitadel/api", "@zitadel/components", "@zitadel/design-tokens"] },
  vue: { compilerOptions: { isCustomElement: (tag) => tag.startsWith("zitadel-") } },
});
`;
    expect(edit(earlier)).toBe(earlier);
  });

  it("recognises a wired config that has no transpile entries", () => {
    const once = edit("export default defineNuxtConfig({})");
    expect(edit(once)).toBe(once);
    expect(once).not.toContain("build");
  });

  it("keeps a transpile list the app declares itself", () => {
    const out = edit('export default defineNuxtConfig({ build: { transpile: ["my-lib"] } })');
    expect(out).toContain('transpile: ["my-lib"]');
    expect(out).not.toContain("@zitadel/components");
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
