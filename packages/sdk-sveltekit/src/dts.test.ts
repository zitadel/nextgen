import { existsSync, readFileSync } from "node:fs";
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
    const files = [...entries].map((entry) => path.resolve(packageDir, entry));
    expect(files.filter((file) => !existsSync(file))).toEqual([]);

    const declared = new Set(
      Object.keys({
        ...manifest.dependencies,
        ...manifest.peerDependencies,
        ...manifest.optionalDependencies,
      }),
    );
    const program = ts.createProgram(files, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
      strict: true,
      skipLibCheck: false,
      noEmit: true,
      types: [],
    });

    const errors = ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file === undefined || path.resolve(d.file.fileName).startsWith(distDir))
      .filter((d) => {
        // A declared dependency whose own typings do not resolve under
        // `nodenext` is that dependency's problem; an undeclared one is ours.
        const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
        const specifier = /Cannot find module '([^']+)'/.exec(message)?.[1];
        if (d.code !== 2307 || specifier === undefined || specifier.startsWith(".")) return true;
        const name = specifier
          .split("/")
          .slice(0, specifier.startsWith("@") ? 2 : 1)
          .join("/");
        return !declared.has(name);
      })
      .map((d) => {
        const line = d.file ? d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1 : 0;
        return `${path.relative(packageDir, d.file?.fileName ?? "")}:${line} TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
      });

    expect(errors).toEqual([]);
  });

  it("export no value the JavaScript lacks", { timeout: 120_000 }, () => {
    const manifest = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));
    const missing: string[] = [];
    for (const { types, js } of entryPairs(manifest.exports)) {
      const runtime = new Set(jsExportNames(path.resolve(packageDir, js)));
      for (const name of valueExportNames(path.resolve(packageDir, types))) {
        if (!runtime.has(name)) missing.push(`${types}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

// Every `exports` condition object that pairs a `types` entry with its
// JavaScript (`import`, else `default`).
function entryPairs(node: unknown, found: { types: string; js: string }[] = []) {
  if (node === null || typeof node !== "object") return found;
  const record = node as Record<string, unknown>;
  const js = typeof record.import === "string" ? record.import : record.default;
  if (typeof record.types === "string" && typeof js === "string" && !js.includes("*")) {
    found.push({ types: record.types, js });
  }
  for (const value of Object.values(record)) entryPairs(value, found);
  return found;
}

// The names a module's declarations let a consumer use as a value: a probe
// file imports each by name and reads it, and the type-only ones fail to
// compile.
function valueExportNames(declarations: string): string[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ESNext,
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const first = ts.createProgram([declarations], options);
  const checker = first.getTypeChecker();
  const source = first.getSourceFile(declarations);
  const moduleSymbol = source && checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [];
  const names = checker
    .getExportsOfModule(moduleSymbol)
    .map((symbol) => symbol.name)
    .filter((name) => name !== "default" && /^[A-Za-z_$][\w$]*$/.test(name));

  const probe = path.join(path.dirname(declarations), "__dts_probe__.mts");
  const specifier = `./${path.basename(declarations).replace(/\.d\.(m?)ts$/, ".$1js")}`;
  const lines = [
    `import { ${names.join(", ")} } from ${JSON.stringify(specifier)};`,
    ...names.map((n) => `${n};`),
  ];
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (
    (exists) => (file: string) =>
      file === probe || exists(file)
  )(host.fileExists.bind(host));
  host.getSourceFile = (file, language, ...rest) =>
    file === probe
      ? ts.createSourceFile(file, lines.join("\n"), language)
      : getSourceFile(file, language, ...rest);
  const program = ts.createProgram([probe], options, host);
  const typeOnlyLines = new Set(
    ts
      .getPreEmitDiagnostics(program)
      .filter((d) => d.file?.fileName === probe)
      .map((d) => d.file?.getLineAndCharacterOfPosition(d.start ?? 0).line),
  );
  return names.filter((_, index) => !typeOnlyLines.has(index + 1));
}

// The names a built JavaScript module exports, read from its ESM syntax.
function jsExportNames(file: string): string[] {
  const program = ts.createProgram([file], {
    allowJs: true,
    checkJs: false,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noEmit: true,
    types: [],
  });
  const source = program.getSourceFile(file);
  const moduleSymbol = source && program.getTypeChecker().getSymbolAtLocation(source);
  return moduleSymbol
    ? program
        .getTypeChecker()
        .getExportsOfModule(moduleSymbol)
        .map((s) => s.name)
    : [];
}
