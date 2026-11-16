import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles } from "@tests/helpers/source-files";
import { stripAnsi } from "@tests/helpers/run-cli";
import { arrow, command, dim, id, mark, path, strong, url } from "@/lib/style";

const SRC = join(import.meta.dirname, "../../../src");

/**
 * Who may take `picocolors` directly: the palette itself, the UI package, which
 * is the one place the CLI draws, and the server log, which is told whether to
 * color by its caller instead of asking the terminal.
 */
const MAY_IMPORT = new Set(["lib/style.ts", "lib/local-server/server-log.ts"]);
const UI_PACKAGE = "lib/ui/";

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

  // A fragment from the palette goes into a painted rendering, printed as it
  // came so the colour survives, so it has to be safe before it gets there.
  it.each([
    ["command", command],
    ["path", path],
    ["url", url],
    ["id", id],
    ["dim", dim],
    ["strong", strong],
  ])("spells out what %s is given", (_name, style) => {
    const styled = style("app.acme.com\u001b[2Jwiped");

    expect(stripAnsi(styled)).toBe("app.acme.com\\x1b[2Jwiped");
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

    expect(
      direct.flat().filter((file) => !MAY_IMPORT.has(file) && !file.startsWith(UI_PACKAGE)),
    ).toEqual([]);
  });
});
