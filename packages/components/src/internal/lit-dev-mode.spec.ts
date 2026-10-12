import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Resolved from the package cwd, not `import.meta.url` — vite rewrites module
// URLs, and vitest always runs with the package directory as cwd.
const SRC = join(process.cwd(), "src");

/** Public entries that load `lit`; each must silence the notice before it does. */
const LIT_ENTRIES = ["index.ts", "atoms/index.ts", "orchestrator/index.ts"];

const FIRST_IMPORT = /^(?:import|export)\s[^;]*?["']([^"']+)["']/m;

describe("lit dev-mode notice", () => {
  it("is silenced under the test runner", () => {
    const { litIssuedWarnings } = globalThis as { litIssuedWarnings?: Set<string> };
    expect(litIssuedWarnings?.has("dev-mode")).toBe(true);
  });

  it("leaves Lit's other dev warnings enabled", () => {
    const { litIssuedWarnings } = globalThis as { litIssuedWarnings?: Set<string> };
    expect(litIssuedWarnings?.has("multiple-versions")).toBe(false);
  });

  it.each(LIT_ENTRIES)("%s silences it before anything else loads", (entry) => {
    const source = readFileSync(join(SRC, entry), "utf8");
    expect(source.match(FIRST_IMPORT)?.[1]).toMatch(/\/internal\/lit-dev-mode\.js$/);
  });
});
