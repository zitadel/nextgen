import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const LIBRARY = join(import.meta.dirname, "../../../../src/lib/upgrade");

/**
 * The only things `lib/upgrade` may import: itself, node, semver and the two npm
 * libs. This checks direct imports only: `lib/package-manager` itself reaches
 * `public-cli` and `cmd` for how a command is spelled.
 */
const ALLOWED = /^(\.\/|node:|semver$|@\/lib\/npm$|@\/lib\/package-manager$)/;

/** Every module a source imports: `from "x"`, `import "x"` and `import("x")`. */
function importsIn(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*"([^"]+)"/g)].map((match) => {
    return match[1] ?? "";
  });
}

describe("lib/upgrade", () => {
  it("knows nothing of Zitadel, the CLI, oclif or how it is drawn", () => {
    const offending = readdirSync(LIBRARY).flatMap((file) => {
      return importsIn(readFileSync(join(LIBRARY, file), "utf8"))
        .filter((source) => !ALLOWED.test(source))
        .map((source) => `${file} imports ${source}`);
    });

    expect(offending).toEqual([]);
  });
});

describe("importsIn", () => {
  it("sees a static, a bare and a dynamic import", () => {
    const source =
      'import { a } from "./a";\nimport "@/lib/b";\nconst c = await import("@/lib/c");';

    expect(importsIn(source)).toEqual(["./a", "@/lib/b", "@/lib/c"]);
  });
});
