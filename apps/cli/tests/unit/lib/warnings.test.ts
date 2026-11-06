import { readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles } from "@tests/helpers/source-files";
import { reportWarning, takeReportedWarnings } from "@/lib/warnings";

const SRC = join(import.meta.dirname, "../../../src");

describe("reportWarning", () => {
  it("keeps each warning until it is taken", () => {
    takeReportedWarnings();

    reportWarning("one");
    reportWarning("two");

    expect(takeReportedWarnings()).toEqual(["one", "two"]);
    expect(takeReportedWarnings()).toEqual([]);
  });

  // The envelope is what a reader parses, and `logJson` spells its text out as
  // JSON does, so keeping the escaped form here would spell it twice and hand
  // the reader `\x1b` as literal text instead of the value.
  it("keeps a warning as it came for the envelope, where the terminal gets it spelled out", () => {
    takeReportedWarnings();

    reportWarning("schema \u001b[2Jwiped has no identifier");

    expect(takeReportedWarnings()).toEqual(["schema \u001b[2Jwiped has no identifier"]);
  });

  // A direct consola.warn is silenced by --json, so the warning never reaches
  // an agent. reportWarning is the one place allowed to call it.
  it("is the only caller of consola.warn", async () => {
    const callers: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      if (/consola\.warn\(/.test(await readFile(file, "utf8"))) {
        // Compared with forward slashes, so the test also passes on Windows.
        callers.push(relative(SRC, file).split(sep).join("/"));
      }
    }

    expect(callers).toEqual(["lib/warnings.ts"]);
  });
});
