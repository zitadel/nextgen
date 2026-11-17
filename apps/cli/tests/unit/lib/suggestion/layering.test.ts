import { readdir, readFile } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The `lib` directories that may render a suggestion: the renderer itself, the
 * oclif layer that runs a command.
 */
const MAY_RENDER = ["lib/suggestion/", "lib/oclif/"];

/**
 * What renders a suggestion, as `lib/suggestion` exports it.
 */
const RENDERERS = ["Suggest", "SuggestWords", "Again", "Guidance", "suggesterFor"];

const SRC = fileURLToPath(new URL("../../../../src", import.meta.url));

describe("lib/suggestion layering", () => {
  it("is imported for a renderer by the oclif layer, the local server and commands only", async () => {
    const files = (await readdir(join(SRC, "lib"), { recursive: true })).filter((file) => {
      return file.endsWith(".ts");
    });
    const rendering: string[] = [];
    for (const file of files) {
      const path = posix.join("lib", file.split(sep).join(posix.sep));
      if (
        MAY_RENDER.some((layer) => {
          return path.startsWith(layer);
        })
      ) {
        continue;
      }
      const source = await readFile(join(SRC, path), "utf8");
      for (const match of source.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+"@\/lib\/suggestion"/g,
      )) {
        const names = (match[1] ?? "").split(",").map((name) => {
          return name
            .replace(/^\s*type\s+/, "")
            .trim()
            .split(/\s+as\s+/)[0];
        });
        for (const name of names) {
          if (name !== undefined && RENDERERS.includes(name)) {
            rendering.push(`${path}: ${name}`);
          }
        }
      }
    }

    expect(rendering).toEqual([]);
  });
});
