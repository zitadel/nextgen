import { EMPTY_SUMMARY, loadProjectEnv } from "./local/env-vars";

export type { EnvSummary, ResolvedEnv } from "./local/env-vars";

/** The `NEXTGEN_*` settings a project hands the local server it starts. */
export class ProjectEnv {
  /** What a start that injected nothing reports. */
  static readonly EMPTY: typeof EMPTY_SUMMARY = EMPTY_SUMMARY;

  /** Reads the project's env files and the defaults a local server needs. */
  static readonly load = loadProjectEnv;
}
