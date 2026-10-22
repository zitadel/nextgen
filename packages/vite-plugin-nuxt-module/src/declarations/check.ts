import { relative, resolve } from "node:path";
import type * as TypeScript from "typescript";

import { CONSUMER_COMPILER_OPTIONS, SOURCE_ROOT, TEST_FILE_GLOBS } from "../defaults.ts";
import { posixPath } from "../entries.ts";
import { matchesAnyGlob } from "../glob.ts";
import { packageTypeScript } from "../resolve.ts";
import { parsedTsconfig, type TS } from "../tsconfig.ts";

/** `diagnostics` that are errors, formatted relative to `root`. */
function errors(ts: TS, root: string, diagnostics: readonly TypeScript.Diagnostic[]): string[] {
  const host: TypeScript.FormatDiagnosticsHost = {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  };
  return diagnostics
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => ts.formatDiagnostic(d, host).trimEnd());
}

/** Compiler options a declaration step overrides on top of a tsconfig's. */
export type CompilerOverrides = Readonly<Record<string, unknown>>;

/**
 * The compiler options and files of `tsconfig`, as a consumer resolves dependencies, with the
 * options the declarations are emitted under (`overrides`) on top, for checking only.
 */
function checkedProject(
  ts: TS,
  tsconfig: string,
  overrides: CompilerOverrides = {},
): TypeScript.ParsedCommandLine {
  return parsedTsconfig(ts, tsconfig, {
    ...CONSUMER_COMPILER_OPTIONS,
    ...(overrides as TypeScript.CompilerOptions),
    noEmit: true,
    composite: false,
    incremental: false,
  });
}

/** Whether `file` is a test under `sourceRoot` (relative to `root`): {@link TEST_FILE_GLOBS}. */
export function isSourceTest(root: string, sourceRoot: string, file: string): boolean {
  const path = posixPath(relative(resolve(root, sourceRoot), file));
  return !path.startsWith("..") && matchesAnyGlob(path, TEST_FILE_GLOBS);
}

/** Options of {@link sourceTypeErrors}. */
export interface SourceCheckOptions {
  /** The compiler options the declarations are emitted under, on top of the tsconfig's. */
  readonly overrides?: CompilerOverrides;
  /** The source root (relative to `root`) whose tests are left out (default `src`). */
  readonly sourceRoot?: string;
}

/**
 * The type errors of the package's sources under `tsconfig`, as `tsc -p` reports them (option and
 * global diagnostics included), with the tests under the source root left out: they are never
 * shipped, and every declaration mode leaves them out. Declaration emitters report only the errors
 * that stop an emit; a wrong type (`const x: number = "s"`) emits fine, so every declaration step
 * checks the program itself. It is checked under the options the declarations are emitted with
 * (`overrides`: the `paths` / `types` a framework hoists), since a tsconfig that sets `declaration`
 * adds the declaration diagnostics those options decide.
 */
export function sourceTypeErrors(
  root: string,
  tsconfig: string,
  options: SourceCheckOptions = {},
): string[] {
  const { overrides, sourceRoot = SOURCE_ROOT } = options;
  const ts = packageTypeScript(root);
  const project = checkedProject(ts, tsconfig, overrides);
  const program = ts.createProgram({
    rootNames: project.fileNames.filter((file) => !isSourceTest(root, sourceRoot, file)),
    options: project.options,
    host: ts.createCompilerHost(project.options),
  });
  return errors(ts, root, [...project.errors, ...ts.getPreEmitDiagnostics(program)]);
}

/**
 * The type errors of written declaration files (`files`, absolute), checked as a consumer reads
 * them: a declaration bundler can emit a reference to a name it never declares (a namespace of a
 * merged module), which compiles to `any` under `skipLibCheck` and fails without it. Only errors
 * inside `outDir` count: the dependencies' own declarations are theirs to check. `overrides` are
 * the compiler options the declarations were emitted with on top of the tsconfig's.
 */
export function declarationTypeErrors(
  root: string,
  tsconfig: string,
  outDir: string,
  files: readonly string[],
  overrides: CompilerOverrides = {},
): string[] {
  if (files.length === 0) return [];
  const ts = packageTypeScript(root);
  const { options } = checkedProject(ts, tsconfig, overrides);
  const program = ts.createProgram(files, {
    ...options,
    skipLibCheck: false,
    rootDir: undefined,
    declarationDir: undefined,
    outDir: undefined,
  });
  const own = program
    .getSourceFiles()
    .filter((sf) => !relative(resolve(outDir), sf.fileName).startsWith(".."));
  return errors(
    ts,
    root,
    own.flatMap((sf) => [
      ...program.getSyntacticDiagnostics(sf),
      ...program.getSemanticDiagnostics(sf),
    ]),
  );
}
