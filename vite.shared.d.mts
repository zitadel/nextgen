/**
 * Types for `vite.shared.mjs`. Hand-written, like `vitest.shared.d.mts`, so the
 * declaration stays version-neutral and resolves under both `bundler` and
 * `nodenext` TypeScript projects without joining each project's file list.
 */
export interface LibraryBuildOptions {
  /** The source directory relative to the package root (default `src`). */
  src?: string;
  /** Rolldown warning codes that do not fail the build; comment each one where it is passed. */
  allow?: string[];
}

/** The shared library build, derived from the package's `exports`; see the implementation. */
export declare function libraryBuild(
  root: string,
  options?: LibraryBuildOptions,
): import("vite").Plugin;

/** A diagnostic as `unplugin-dts` passes it, reduced to what the message needs. */
export interface DeclarationDiagnostic {
  file?:
    | {
        fileName: string;
        getLineAndCharacterOfPosition(position: number): { line: number; character: number };
      }
    | undefined;
  start?: number | undefined;
  messageText: string | { messageText: string };
}

/** The `afterDiagnostic` hook for `unplugin-dts` that fails the build on any diagnostic. */
export declare function failOnDiagnostics(diagnostics: readonly DeclarationDiagnostic[]): void;
