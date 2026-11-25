import { readFile, readdir } from "node:fs/promises";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { LOCAL_IMPORT, resolveFromSrc } from "@tests/helpers/source-imports";

const root = fileURLToPath(new URL("../../../../src", import.meta.url));
const LAYER = posix.join("lib", "server");
const ERRORS = posix.join(LAYER, "errors.ts");

/**
 * What the server package must not reach for: it throws typed errors and says
 * what it is doing through a callback, and the command layer words, renders and
 * asks. Each entry stands for itself and everything under it.
 *
 * Its `errors.ts` alone may take the data form of a next command from
 * `lib/suggestion`, which the failure handler renders.
 */
const FORBIDDEN = ["lib/ui", "lib/suggestion", "lib/consent", "lib/oclif", "cli"];

describe("the server package", () => {
  it("reaches for no command wording, rendering or consent", async () => {
    const files = (await readdir(join(root, LAYER), { recursive: true })).filter((file) => {
      return file.endsWith(".ts");
    });
    const reaching: string[] = [];

    for (const file of files) {
      const path = posix.join(LAYER, file.split("\\").join("/"));
      const source = await readFile(join(root, path), "utf8");
      for (const match of source.matchAll(LOCAL_IMPORT)) {
        const target = resolveFromSrc(path, match[1] ?? "").replace(/\.(ts|js)$/, "");
        if (path === ERRORS && target === "lib/suggestion") {
          continue;
        }
        if (
          FORBIDDEN.some((module) => {
            return target === module || target.startsWith(`${module}/`);
          })
        ) {
          reaching.push(`${path} -> ${target}`);
        }
      }
    }

    expect(reaching).toEqual([]);
  });
});
