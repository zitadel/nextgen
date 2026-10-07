/**
 * Types for `vitest.flake-diag.mjs` (spike #1490). Structural rather than
 * imported from `vite`, so the root declaration does not need `vite` to be
 * resolvable from the workspace root.
 */
export interface FlakeDiagPlugin {
  name: string;
  configureServer(server: any): void;
}

export declare const flakeDiagDir: string;
export declare function flakeDiagPlugin(name: string): FlakeDiagPlugin;
export declare function flakeDiagLaunchArgs(name: string): string[];
