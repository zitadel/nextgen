import { readdir, readFile } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_IMPORT, resolveFromSrc } from "@tests/helpers/source-imports";

const backend = fileURLToPath(new URL("../../../../src/lib/backend", import.meta.url));

/** The backend reaches nothing under `lib/` outside itself. */
const ALLOWED: readonly string[] = [];

const LAYER = posix.join("lib", "backend");

describe("the backend's dependencies", () => {
  it("reach nothing under lib/ outside the backend", async () => {
    const files = (await readdir(backend, { recursive: true })).filter((file) => {
      return file.endsWith(".ts");
    });
    const reached: string[] = [];

    for (const file of files) {
      const source = await readFile(join(backend, file), "utf8");
      for (const [, specifier] of source.matchAll(LOCAL_IMPORT)) {
        if (specifier === undefined || ALLOWED.includes(specifier)) {
          continue;
        }
        // Resolved rather than read off the specifier, because a service in a
        // subdirectory reaches the backend's own modules as `../client`, which
        // leaves its directory without leaving the backend, and any module
        // can be written through the `@/` alias.
        const target = resolveFromSrc(
          posix.join(LAYER, file.split(sep).join(posix.sep)),
          specifier,
        );
        if (target !== LAYER && !target.startsWith(`${LAYER}/`)) {
          reached.push(`${file} imports ${specifier}`);
        }
      }
    }

    expect(reached).toEqual([]);
  });
});
