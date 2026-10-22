import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type * as TS from "typescript";

import { searchForWorkspaceRoot } from "vite";

import { CONSUMER_COMPILER_OPTIONS, RUNTIME_OUT_DIR } from "./defaults.ts";
import { posixPath } from "./entries.ts";
import { assertNoBuildPaths } from "./no-build-paths.ts";
import { requiredVueTools } from "./declarations/vue.ts";
import { packageTypeScript } from "./resolve.ts";
import { parsedTsconfig } from "./tsconfig.ts";
import {
  applyEdits,
  rewriteDeclarationImports,
  type SpecifierScope,
  specifierEdits,
} from "./specifiers.ts";
import { effectiveTsconfig } from "./nuxt-tsconfig.ts";

/** What the runtime declaration step needs. */
export interface RuntimeDeclarationsOptions {
  readonly root: string;
  readonly runtimeDir: string;
  readonly outDir: string;
  readonly tsconfig: string | undefined;
  readonly scope: SpecifierScope;
}

/** Where a source file's declaration is written by TypeScript (no `outDir`): next to it. */
export function declarationFileOf(file: string): string {
  if (file.endsWith(".vue")) return `${file}.d.ts`;
  return file.replace(/\.(m|c)?[jt]sx?$/, ".d.$1ts");
}

/**
 * `#app` / `#app/*` are aliases only a Nuxt build resolves: a shipped declaration naming them breaks `tsc` for every
 * consumer. `nuxt/app` re-exports them under a name any resolver finds (what `nuxt-module-build` rewrites them to).
 */
export function rewriteRuntimeTypeAliases(code: string): string {
  return applyEdits(
    code,
    specifierEdits(code, "dts", (spec) => (/^#app(\/|$)/.test(spec) ? "nuxt/app" : undefined)),
  );
}

/**
 * The options of the declaration emit: the module's own tsconfig over `mkdist`'s defaults, emitting declarations only,
 * in memory (no `outDir` / `rootDir`, so runtime files may import sources outside the runtime directory), and
 * resolving dependencies through their published types like a consumer.
 */
export function declarationCompilerOptions(options: TS.CompilerOptions): TS.CompilerOptions {
  const {
    outDir: _outDir,
    declarationDir: _declarationDir,
    rootDir: _rootDir,
    outFile: _outFile,
    composite: _composite,
    incremental: _incremental,
    tsBuildInfoFile: _tsBuildInfoFile,
    ...own
  } = options;
  return {
    skipLibCheck: true,
    strictNullChecks: true,
    allowImportingTsExtensions: true,
    ...own,
    ...CONSUMER_COMPILER_OPTIONS,
    allowJs: true,
    allowNonTsExtensions: true,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: false,
    noEmitOnError: false,
    declarationMap: false,
    sourceMap: false,
    inlineSourceMap: false,
  };
}

/** TypeScript's "cannot find module" diagnostics: an import whose types a declaration would lose to `any`. */
export const UNRESOLVED_MODULE_CODES: readonly number[] = [2307, 2792];

/**
 * `.d.ts` for the transpiled runtime, emitted in process like `mkdist` does: one program over the runtime's scripts
 * (`.js` included) and its `.vue` files, read through `vue-tsc` (see `vueTools`), with the ambient declarations the
 * tsconfig compiles with (a `declare module "#imports"` shim). A runtime with `.vue` files fails without it (`mkdist`
 * warns and ships those components untyped). A declaration the compiler cannot emit for a runtime file fails the
 * build, as `nuxt-module-build` fails it, and so does an import it cannot resolve (`#imports` before `prepare`), whose
 * types the declaration would silently lose to `any`; other type errors do not (type checking is its own step).
 * Relative specifiers then get explicit extensions, like `mkdist`'s `addRelativeDeclarationExtensions`, and `#app`
 * imports become `nuxt/app`. A declaration that names the build machine's paths fails the build too.
 */
export async function emitRuntimeDeclarations(
  o: RuntimeDeclarationsOptions,
  scripts: readonly string[],
  vues: readonly string[],
): Promise<void> {
  const out = join(o.outDir, RUNTIME_OUT_DIR);
  const tsconfig = effectiveTsconfig(o.root, o.tsconfig);
  const vue = vues.length
    ? requiredVueTools(
        o.root,
        `nuxtModule: the runtime has .vue files (${vues.map((f) => relative(o.runtimeDir, f)).join(", ")}) to type`,
      )
    : undefined;
  const ts = vue?.ts ?? packageTypeScript(o.root);
  const inputs = [...scripts, ...vues].map((f) => resolve(f));
  if (inputs.length) {
    const project = parsedTsconfig(ts, tsconfig);
    const options = declarationCompilerOptions(project.options);
    const ambient = project.fileNames.filter((f) => /\.d\.[cm]?ts$/.test(f));
    const host = ts.createCompilerHost(options);
    const written = new Map<string, string>();
    host.writeFile = (name, text) => {
      written.set(resolve(name), text);
    };
    const createProgram = vue ? vue.createProgram(tsconfig) : ts.createProgram;
    const program = createProgram({ rootNames: [...inputs, ...ambient], options, host });
    const unresolved = inputs.flatMap((input) => {
      const file = program.getSourceFile(input);
      return file
        ? program
            .getSemanticDiagnostics(file)
            .filter((d) => UNRESOLVED_MODULE_CODES.includes(d.code))
        : [];
    });
    if (unresolved.length)
      throw new Error(
        `nuxtModule: the runtime imports modules TypeScript cannot resolve, whose types its declarations would lose:\n${ts.formatDiagnostics(unresolved, host)}Run \`nuxi prepare\` (or set \`prepare: true\`) with a tsconfig that extends .nuxt/tsconfig.json, or declare them in the tsconfig's files.`,
      );
    const result = program.emit();
    const own = new Set(inputs);
    const shipped: [string, string][] = [];
    const failures = result.diagnostics.filter((d) => d.file && own.has(resolve(d.file.fileName)));
    if (failures.length)
      throw new Error(
        `nuxtModule: cannot emit declarations for the runtime:\n${ts.formatDiagnostics(failures, host)}`,
      );
    for (const input of inputs) {
      // A declaration written by hand next to its source (`plain.js` + `plain.d.ts`) is shipped as written.
      if (existsSync(declarationFileOf(input))) continue;
      const rel = relative(o.runtimeDir, declarationFileOf(input));
      const text = written.get(declarationFileOf(input));
      if (text === undefined)
        throw new Error(`nuxtModule: no declaration was emitted for ${input}`);
      const dest = join(out, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const code = rewriteRuntimeTypeAliases(
        rewriteDeclarationImports(text, join(o.runtimeDir, rel), o.scope),
      );
      writeFileSync(dest, code);
      shipped.push([dest, code]);
      // vue-tsc names these `X.vue.d.ts`; newer TS tooling also looks for `X.d.vue.ts`.
      if (rel.endsWith(".vue.d.ts"))
        writeFileSync(join(out, rel.replace(/\.vue\.d\.ts$/, ".d.vue.ts")), code);
    }
    assertNoBuildPaths(shipped, posixPath(searchForWorkspaceRoot(o.root)));
  }
}
