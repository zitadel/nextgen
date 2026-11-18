import ci from "ci-info";

import type { Property } from "@/lib/telemetry/property";

/**
 * The CI service the process runs in, as a lowercase name with underscores
 * (`github_actions`, `gitlab_ci`), `unknown` for CI `ci-info` has no name for,
 * and `undefined` when not running in CI.
 */
class CiProvider implements Property<NodeJS.ProcessEnv, string | undefined> {
  public value(_env: NodeJS.ProcessEnv): string | undefined {
    if (!ci.isCI) {
      return undefined;
    }

    return ci.name?.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replaceAll(/^_|_$/g, "") ?? "unknown";
  }
}

export const ciProvider = new CiProvider();

/**
 * Whether this runs in a CI build, as `ci-info` reads it.
 *
 * @param _env - Unused: `ci-info` reads the process's own environment.
 * @returns Whether the process runs in CI.
 */
export function runsInCi(_env: NodeJS.ProcessEnv): boolean {
  return ci.isCI;
}
