import { readdir, readFile } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_IMPORT, resolveFromSrc } from "@tests/helpers/source-imports";

const idp = fileURLToPath(new URL("../../../../src/lib/idp", import.meta.url));

const LAYER = posix.join("lib", "idp");

const BACKEND = posix.join("lib", "backend");

describe("the identity-provider module's dependencies", () => {
  it("never reach the backend", async () => {
    const files = (await readdir(idp, { recursive: true })).filter((file) => {
      return file.endsWith(".ts");
    });
    const reached: string[] = [];

    for (const file of files) {
      const source = await readFile(join(idp, file), "utf8");
      for (const [, specifier] of source.matchAll(LOCAL_IMPORT)) {
        if (specifier === undefined) {
          continue;
        }
        const target = resolveFromSrc(
          posix.join(LAYER, file.split(sep).join(posix.sep)),
          specifier,
        );
        if (target === BACKEND || target.startsWith(`${BACKEND}/`)) {
          reached.push(`${file} imports ${specifier}`);
        }
      }
    }

    expect(reached).toEqual([]);
  });
});
