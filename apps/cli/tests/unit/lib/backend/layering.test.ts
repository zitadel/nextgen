import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const backend = fileURLToPath(new URL("../../../../src/lib/backend", import.meta.url));

/** The backend reaches nothing under `lib/` outside itself. */
const ALLOWED: readonly string[] = [];

const IMPORT = /\bfrom\s+"(\.[^"]*)"/g;

describe("the backend's dependencies", () => {
  it("reach nothing under lib/ outside the backend", async () => {
    const files = (await readdir(backend, { recursive: true })).filter((file) =>
      file.endsWith(".ts"),
    );
    const reached: string[] = [];

    for (const file of files) {
      const source = await readFile(join(backend, file), "utf8");
      for (const [, specifier] of source.matchAll(IMPORT)) {
        if (
          specifier !== undefined &&
          !specifier.startsWith("./") &&
          !ALLOWED.includes(specifier)
        ) {
          reached.push(`${file} imports ${specifier}`);
        }
      }
    }

    expect(reached).toEqual([]);
  });
});
