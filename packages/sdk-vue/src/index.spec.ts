import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The package ships only what its build emits, so an `exports` target the build
// misses breaks every consumer that imports it. `test` runs after `build`.
describe("package manifest", () => {
  const packageRoot = resolve(import.meta.dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
    main?: string;
    module?: string;
    types?: string;
    exports: unknown;
    peerDependencies: Record<string, string>;
  };

  function targets(value: unknown): string[] {
    if (typeof value === "string") return value.startsWith("./") ? [value] : [];
    if (value && typeof value === "object") return Object.values(value).flatMap(targets);
    return [];
  }

  it("ships every exports target in dist", () => {
    const declared = targets([manifest.exports, manifest.main, manifest.module, manifest.types]);
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((file) => !existsSync(resolve(packageRoot, file)))).toEqual([]);
  });

  it("declares its supported peer ranges", () => {
    expect(manifest.peerDependencies).toEqual({
      vue: ">=3",
    });
  });
});
