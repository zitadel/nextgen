/**
 * Creates a brand-new project of a given framework in an (empty) directory.
 * The Orca orchestrator picks the first scaffolder whose {@link canScaffold}
 * returns true. Distinct from a {@link import("@/lib/orca/patchers/types").Patcher},
 * which integrates Zitadel into an *existing* project.
 */
export interface Scaffolder {
  /** Human-readable label shown in the framework picker. */
  readonly displayName: string;
  /** Framework identifiers this scaffolder can produce. */
  readonly supportedFrameworks: ReadonlyArray<string>;
  /** Whether this scaffolder can produce the requested framework. */
  canScaffold(framework: string): boolean;
  /** Create the project in `cwd`; the directory must already exist. */
  scaffold(cwd: string, framework: string): Promise<void>;
  /**
   * A `package.json` script of the app this creates that writes files the
   * framework derives from its source, such as a route tree. Setup runs it once
   * it has installed the dependencies, so its commit holds them current with
   * the files the patcher wrote, and the first dev run changes nothing.
   */
  readonly afterInstallScript?: string;
}
