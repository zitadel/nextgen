/**
 * Types for `vitest.shared.mjs`. Hand-written (not derived from `vitest/config`)
 * so the declaration stays version-neutral: every project typechecks against
 * Vitest 4 today, and `baseTest` must accept being spread into their own `test`
 * config without coupling this base to a specific Vitest version's type. Literal
 * types (`false`, `"v8"`, the reporter tuple) keep it assignable to `test`.
 */
export interface BaseTest {
  watch: false;
  globals: true;
  fileParallelism: true;
  passWithNoTests: boolean;
  include: string[];
  reporters: ["default", "junit"];
  outputFile: { junit: string };
  coverage: {
    provider: "v8";
    reportsDirectory: string;
    include: string[];
  };
}

export declare const baseTest: BaseTest;
export declare const sourceConditions: string[];

/**
 * SPIKE (#1499): wrap `@vitest/browser-playwright`'s `playwright()` so the
 * browser suites share one Chromium across their separate `vitest` processes.
 * The caller passes its own `playwright` factory and `chromium` (pnpm: this
 * root file cannot resolve them). Returns the provider descriptor for `provider:`.
 */
export declare function sharedChromium(deps: {
  playwright: (options?: object) => unknown;
  chromium: unknown;
  options?: object;
}): unknown;
