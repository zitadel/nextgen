/** Options passed to a scaffolder when creating a new project from scratch. */
export type ScaffoldOptions = Readonly<{
  packageManager?: string;
}>;

/**
 * Creates a brand-new project of a given framework in an (empty) directory.
 * The Orca orchestrator picks the first scaffolder whose {@link canScaffold}
 * returns true. Distinct from a {@link import("../patchers/types").Patcher},
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
  scaffold(cwd: string, framework: string, opts: ScaffoldOptions): Promise<void>;
}
