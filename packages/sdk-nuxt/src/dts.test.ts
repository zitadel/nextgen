import { readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// Compiles the built type entries the way a strict consumer's editor would
// (`nodenext`, `skipLibCheck: false`). attw proves the entry points resolve;
// this proves the declarations themselves are valid, for example that a
// bundler left no name undefined. Only errors inside this package's own `dist`
// count, so a dependency's typings cannot fail it.
const packageDir = process.cwd();
const distDir = path.join(packageDir, "dist") + path.sep;

function typesEntries(node: unknown, found = new Set<string>()): Set<string> {
  if (node === null || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === "types" && typeof value === "string" && !value.includes("*")) found.add(value);
    else typesEntries(value, found);
  }
  return found;
}

describe("published types", () => {
  it("compile for a strict consumer", { timeout: 120_000 }, () => {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
    const entries = typesEntries(manifest.exports);
    if (typeof manifest.types === "string") entries.add(manifest.types);
    expect([...entries]).not.toEqual([]);

    const program = ts.createProgram(
      [...entries].map((entry) => path.resolve(packageDir, entry)),
      {
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        target: ts.ScriptTarget.ESNext,
        lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
        strict: true,
        skipLibCheck: false,
        noEmit: true,
        types: [],
      },
    );

    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file !== undefined && path.resolve(d.file.fileName).startsWith(distDir))
      .filter((d) => {
        // A bare import the dependency's own typings do not resolve under
        // `nodenext` is that dependency's problem, not this package's.
        const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
        const specifier = /Cannot find module '([^']+)'/.exec(message)?.[1];
        return !(d.code === 2307 && specifier !== undefined && !specifier.startsWith("."));
      })
      .map((d) => {
        const line = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : 0;
        return `${path.relative(packageDir, d.file?.fileName ?? "")}:${line} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
      });

    expect(errors).toEqual([]);
  });
});
