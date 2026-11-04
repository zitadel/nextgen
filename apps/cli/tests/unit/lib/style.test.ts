import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles } from "../../helpers/source-files";
import { stripAnsi } from "../../helpers/run-cli";
import { arrow, id, mark } from "../../../src/lib/style";

const SRC = join(import.meta.dirname, "../../../src");

/**
 * Who may take `picocolors` directly: the palette itself, and the server log,
 * which is told whether to color by its caller instead of asking the terminal.
 */
const MAY_IMPORT = new Set(["lib/style.ts", "lib/local-server/server-log.ts"]);

describe("the palette", () => {
  it("marks each outcome", () => {
    expect(stripAnsi(mark.pass)).toBe("✓");
    expect(stripAnsi(mark.warn)).toBe("!");
    expect(stripAnsi(mark.fail)).toBe("✗");
    expect(stripAnsi(arrow)).toBe("→");
  });

  it("leaves an id plain, so yellow always means a warning", () => {
    expect(id("proj_123")).toBe("proj_123");
  });

  it("is the only way to color human output", async () => {
    const files = await sourceFiles(SRC);
    const direct = await Promise.all(
      files.map(async (file) =>
        /from\s*["']picocolors["']|(?:import|require)\(\s*["']picocolors["']/.test(
          await readFile(file, "utf8"),
        )
          ? [relative(SRC, file).replaceAll("\\", "/")]
          : [],
      ),
    );

    expect(direct.flat().filter((file) => !MAY_IMPORT.has(file))).toEqual([]);
  });
});
