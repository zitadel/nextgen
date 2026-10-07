import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { reportWarning, takeReportedWarnings } from "../../../src/lib/warnings";

const SRC = join(import.meta.dirname, "../../../src");

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) =>
      entry.isDirectory()
        ? sourceFiles(join(dir, entry.name))
        : Promise.resolve(entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []),
    ),
  );
  return nested.flat();
}

describe("reportWarning", () => {
  it("keeps each warning until it is taken", () => {
    takeReportedWarnings();

    reportWarning("one");
    reportWarning("two");

    expect(takeReportedWarnings()).toEqual(["one", "two"]);
    expect(takeReportedWarnings()).toEqual([]);
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
