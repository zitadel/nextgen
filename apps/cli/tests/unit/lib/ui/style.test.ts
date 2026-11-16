import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles } from "@tests/helpers/source-files";
import { stripAnsi } from "@tests/helpers/run-cli";
import { style } from "@/lib/ui/style";

const SRC = join(import.meta.dirname, "../../../../src");

/**
 * Who may take `picocolors` directly: the UI package, which holds the palette and
 * is the one place the CLI draws, and the server log, which is told whether to
 * color by its caller instead of asking the terminal.
 */
const MAY_IMPORT = new Set(["lib/server/local/server-log.ts"]);
const UI_PACKAGE = "lib/ui/";

describe("the palette", () => {
  it("marks each outcome", () => {
    expect(stripAnsi(style.mark.pass)).toBe("✓");
    expect(stripAnsi(style.mark.warn)).toBe("!");
    expect(stripAnsi(style.mark.fail)).toBe("✗");
    expect(stripAnsi(style.arrow)).toBe("→");
  });

  it("leaves an id plain, so yellow always means a warning", () => {
    expect(style.id("proj_123")).toBe("proj_123");
  });

  // A fragment from the palette goes into a painted rendering, printed as it
  // came so the colour survives, so it has to be safe before it gets there.
  it.each([
    ["command", (s: string) => style.command(s)],
    ["path", (s: string) => style.path(s)],
    ["url", (s: string) => style.url(s)],
    ["id", (s: string) => style.id(s)],
    ["dim", (s: string) => style.dim(s)],
    ["strong", (s: string) => style.strong(s)],
  ])("spells out what %s is given", (_name, paint) => {
    const styled = paint("app.acme.com\u001b[2Jwiped");

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
