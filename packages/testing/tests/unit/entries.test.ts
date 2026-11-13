import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(import.meta.dirname, "../../src");

/** Every module specifier a source file imports or re-exports. */
function specifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/\b(?:import|export)\b[^"';]*?\bfrom\s+"([^"]+)"/g)].map(
    (match) => match[1] as string,
  );
}

/** Bare specifiers reachable from an entry through its relative imports. */
function reachableBareImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const queue = [join(SRC, entry)];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const specifier of specifiers(file)) {
      if (specifier.startsWith(".")) {
        queue.push(`${resolve(dirname(file), specifier)}.ts`);
      } else {
        bare.add(specifier);
      }
    }
  }
  return bare;
}

// The optional peers stay optional only while the root entry's graph never
// reaches them: a customer without Playwright or Vitest imports it.
describe("entry points", () => {
  it("keeps the root entry free of the optional peers", () => {
    const imports = [...reachableBareImports("index.ts")];
    expect(imports.filter((name) => /^(vitest|@playwright\/test)(\/|$)/.test(name))).toEqual([]);
  });

  it("keeps the vitest entry free of Playwright", () => {
    const imports = [...reachableBareImports("vitest.ts")];
    expect(imports).toContain("vitest");
    expect(imports.filter((name) => name.startsWith("@playwright/"))).toEqual([]);
  });
});
