import { readdir, readFile } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE = fileURLToPath(new URL("../../../..", import.meta.url));

/** Every file under `dir` whose name ends in `.ts`, as a posix path relative to the package. */
async function sourcesIn(dir: string): Promise<string[]> {
  const files = await readdir(join(PACKAGE, dir), { recursive: true });

  return files
    .filter((file) => {
      return file.endsWith(".ts");
    })
    .map((file) => {
      return posix.join(dir, file.split(sep).join(posix.sep));
    });
}

describe("the server package", () => {
  it("is reached through its entry alone, by everything outside it", async () => {
    const outside = [...(await sourcesIn("src")), ...(await sourcesIn("tests"))].filter((file) => {
      return !file.startsWith("src/lib/server/") && !file.startsWith("tests/unit/lib/server/");
    });

    const deep: string[] = [];
    for (const file of outside) {
      const source = await readFile(join(PACKAGE, file), "utf8");
      for (const match of source.matchAll(/\bfrom\s+"(@\/lib\/server\/[^"]*)"/g)) {
        deep.push(`${file} imports ${match[1]}`);
      }
    }

    expect(deep).toEqual([]);
  });
});
