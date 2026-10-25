#!/usr/bin/env node
// Compiles a package's built type entry the way a strict consumer would
// (`nodenext`, `skipLibCheck: false`) and fails on any error inside the
// package's own `dist`. attw proves the entry points resolve; this proves the
// declarations themselves are valid, e.g. no name left undefined by a bundler.
// Diagnostics from other packages are ignored so a dependency's typings
// cannot fail this package's build, and a bare import a dependency's typings
// do not resolve under `nodenext` is that dependency's problem, not ours.
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const dir = process.cwd();
const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/** Every concrete `types` target in the `exports` map, plus the top-level `types`. */
function typesEntries(node, found = new Set()) {
  if (node === null || typeof node !== "object") return found;
  for (const [key, value] of Object.entries(node)) {
    if (key === "types" && typeof value === "string" && !value.includes("*")) found.add(value);
    else typesEntries(value, found);
  }
  return found;
}
const entries = typesEntries(manifest.exports);
if (typeof manifest.types === "string") entries.add(manifest.types);
if (entries.size === 0) {
  console.error(`check-package-types: ${manifest.name} declares no types entry`);
  process.exit(1);
}

const program = ts.createProgram(
  [...entries].map((entry) => path.resolve(dir, entry)),
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

const distDir = path.join(dir, "dist") + path.sep;
const unresolvedBareImport = (d) => {
  if (d.code !== 2307) return false;
  const specifier = /Cannot find module '([^']+)'/.exec(
    ts.flattenDiagnosticMessageText(d.messageText, " "),
  );
  return specifier !== null && !specifier[1].startsWith(".");
};
const own = ts
  .getPreEmitDiagnostics(program)
  .filter((d) => d.file !== undefined && path.resolve(d.file.fileName).startsWith(distDir))
  .filter((d) => !unresolvedBareImport(d));

for (const d of own) {
  const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0);
  const where = `${path.relative(dir, d.file.fileName)}:${line + 1}`;
  console.error(`${where} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}
if (own.length > 0) {
  console.error(`check-package-types: ${manifest.name} ships ${own.length} invalid declaration(s)`);
  process.exit(1);
}
