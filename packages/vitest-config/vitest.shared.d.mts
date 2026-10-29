/**
 * Types for `vitest.shared.mjs`. Hand-written (not derived from `vitest/config`)
 * so the declaration stays version-neutral: every project typechecks against
 * Vitest 4 today, and `baseTest` must accept being spread into their own `test`
 * config without coupling this base to a specific Vitest version's type. Literal
 * types (`false`, `"v8"`, the reporter tuple) keep it assignable to `test`.
 */
export interface BaseTest {
  watch: false;
  globals: true;
  fileParallelism: true;
  passWithNoTests: boolean;
  include: string[];
  reporters: ["default", "junit"];
  outputFile: { junit: string };
  coverage: {
    provider: "v8";
    reportsDirectory: string;
    include: string[];
  };
}

export declare const baseTest: BaseTest;
export declare const sourceConditions: string[];

/** The glob of the specs that run only in the edge VM. */
export declare const edgeSpecs: string;

export interface EdgeProjectOptions {
  /** Canonical specs that also run in the edge VM, relative to the package root. */
  include?: string[];
  /** Spec files that read the filesystem or need Node built-ins. */
  exclude?: string[];
  /** Extra resolve conditions, for example `sourceConditions`. */
  conditions?: string[];
  /** The package's own `resolve.alias`. */
  alias?: Record<string, string>;
  /** Dependencies allowed to import Node built-ins, because the edge platform polyfills them. */
  polyfilledPackages?: string[];
  /** The package's own Vite plugins, run before the built-in check. */
  plugins?: import("vite").PluginOption[];
}

export interface EdgeProject {
  cacheDir: string;
  plugins: import("vite").PluginOption[];
  resolve: { conditions: string[]; alias: Record<string, string> };
  ssr: { resolve: { conditions: string[] } };
  test: {
    name: "edge";
    globals: true;
    environment: "edge-runtime";
    include: string[];
    exclude: string[];
  };
}

/** A project that runs `include` inside the `edge-runtime` VM; see the implementation. */
export declare function edgeProject(options: EdgeProjectOptions): EdgeProject;
