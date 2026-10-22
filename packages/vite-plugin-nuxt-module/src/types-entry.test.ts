import { describe, expect, it } from "vitest";

import { typesEntry } from "./types-entry.ts";

describe("typesEntry", () => {
  it("derives ModuleOptions from the module when it exports none", () => {
    expect(
      typesEntry("declare const _default: unknown;\nexport default _default;\n", "./module.mjs"),
    ).toContain(
      "export type ModuleOptions = typeof Module extends NuxtModule<infer O> ? Partial<O> : Record<string, any>",
    );
  });

  it("re-exports the module's own ModuleOptions as a type", () => {
    const text = typesEntry("export interface ModuleOptions { a: string }\n", "./module.mjs");
    expect([
      text.includes("export { type ModuleOptions } from './module.mjs'"),
      text.includes("NuxtModule"),
    ]).toEqual([true, false]);
  });

  it("extends the Nuxt hooks with the module's", () => {
    const text = typesEntry(
      "export interface ModuleOptions {}\nexport interface ModuleRuntimeHooks {}\nexport interface ModuleHooks {}\n",
      "./module.mjs",
    );
    expect([
      text.includes(
        "declare module '#app' {\n  interface RuntimeNuxtHooks extends ModuleRuntimeHooks {}\n}",
      ),
      text.includes(
        "declare module '@nuxt/schema' {\n  interface NuxtHooks extends ModuleHooks {}\n}",
      ),
    ]).toEqual([true, true]);
  });

  it("re-exports star exports from their own module", () => {
    expect(
      typesEntry(
        'export interface ModuleOptions {}\nexport * from "./shared/types.mjs";\n',
        "./module.mjs",
      ),
    ).toContain("export * from './shared/types.mjs'");
  });
});
