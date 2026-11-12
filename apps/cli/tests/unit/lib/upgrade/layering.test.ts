import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const LIBRARY = join(import.meta.dirname, "../../../../src/lib/upgrade");

/** The only things `lib/upgrade` may import: itself, node, semver and the two generic npm libs. */
const ALLOWED = /^(\.\/|node:|semver$|@\/lib\/npm$|@\/lib\/package-manager$)/;

function importsOf(file: string): string[] {
  return [...readFileSync(join(LIBRARY, file), "utf8").matchAll(/from "([^"]+)"/g)].map((match) => {
    return match[1] ?? "";
  });
}

describe("lib/upgrade", () => {
  it("knows nothing of Zitadel, the CLI, oclif or how it is drawn", () => {
    const offending = readdirSync(LIBRARY).flatMap((file) => {
      return importsOf(file)
        .filter((source) => !ALLOWED.test(source))
        .map((source) => `${file} imports ${source}`);
    });

    expect(offending).toEqual([]);
  });
});
