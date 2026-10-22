import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walk } from "./walk.ts";

describe("walk", () => {
  it("lists every file below the directory, relative and sorted, without node_modules", () => {
    const dir = mkdtempSync(join(tmpdir(), "vite-walk-"));
    for (const file of ["b.ts", "a/c.vue", "a/b/d.ts", "node_modules/x/index.js"]) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "");
    }
    expect(walk(dir)).toEqual(["a/b/d.ts", "a/c.vue", "b.ts"]);
  });
});
