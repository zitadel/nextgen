/**
 * Types for `vite.shared.mjs`. Hand-written, like `vitest.shared.d.mts`, so the
 * declaration stays version-neutral and resolves under both `bundler` and
 * `nodenext` TypeScript projects without joining each project's file list.
 */

/**
 * Rolldown's minify for an ES library, whitespace included and names kept; see
 * the implementation.
 */
export declare const minify: {
  readonly compress: { readonly keepNames: { readonly function: true; readonly class: true } };
  readonly mangle: { readonly keepNames: true };
  readonly codegen: { readonly removeWhitespace: true };
};

/**
 * The shared library build and its declarations, derived from the package's
 * `exports`; see the implementation.
 *
 * @param root The package directory.
 * @returns The package's Vite config.
 */
export declare function libraryConfig(root: string): import("vite").UserConfig;

/**
 * A diagnostic as `unplugin-dts` passes it, reduced to what the message needs.
 */
export interface DeclarationDiagnostic {
  file?:
    | {
        fileName: string;
        getLineAndCharacterOfPosition(position: number): { line: number; character: number };
      }
    | undefined;
  start?: number | undefined;
  messageText: string | DeclarationMessageChain;
}

/**
 * A diagnostic's message chain: what failed, and under it why.
 */
export interface DeclarationMessageChain {
  messageText: string;
  next?: DeclarationMessageChain[] | undefined;
}

/**
 * The `afterDiagnostic` hook for `unplugin-dts` that fails the build on any diagnostic.
 *
 * @param diagnostics The type errors `unplugin-dts` found in the declarations.
 * @throws {Error} Listing every diagnostic, when there is any.
 */
export declare function failOnDiagnostics(diagnostics: readonly DeclarationDiagnostic[]): void;
