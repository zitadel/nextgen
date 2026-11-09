import { readdir, readFile } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_IMPORT, resolveFromSrc } from "@tests/helpers/source-imports";

const zitadel = fileURLToPath(new URL("../../../../src/lib/zitadel", import.meta.url));

const LAYER = posix.join("lib", "zitadel");

describe("the zitadel library's dependencies", () => {
  it("reach nothing under lib/ outside the library", async () => {
    const files = (await readdir(zitadel, { recursive: true })).filter((file) => {
      return file.endsWith(".ts");
    });
    const reached: string[] = [];

    for (const file of files) {
      const source = await readFile(join(zitadel, file), "utf8");
      for (const [, specifier] of source.matchAll(LOCAL_IMPORT)) {
        if (specifier === undefined) {
          continue;
        }
        const target = resolveFromSrc(
          posix.join(LAYER, file.split(sep).join(posix.sep)),
          specifier,
        );
        if (target.startsWith("lib/") && target !== LAYER && !target.startsWith(`${LAYER}/`)) {
          reached.push(`${file} imports ${specifier}`);
        }
      }
    }

    expect(reached).toEqual([]);
  });
});
