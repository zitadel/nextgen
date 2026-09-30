/**
 * Types for `vitest.shared.mjs`. Hand-written (not derived from `vitest/config`)
 * so the declaration is version-neutral: the SDK family typechecks against
 * Vitest 3 and everything else against Vitest 4, and both must accept `baseTest`
 * when it is spread into their own `test` config. Literal types (`false`,
 * `"v8"`, the reporter tuple) keep it assignable to either major's `test` type.
 */
export interface BaseTest {
  watch: false;
  globals: true;
  fileParallelism: true;
  passWithNoTests: true;
  reporters: ["default", ["junit", { outputFile: string }]];
  coverage: {
    provider: "v8";
    reportsDirectory: string;
    include: string[];
  };
}

export declare const baseTest: BaseTest;
export declare const sourceConditions: string[];
