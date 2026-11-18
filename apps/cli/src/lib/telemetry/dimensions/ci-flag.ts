import ci from "ci-info";

import type { Property } from "@/lib/telemetry/property";

/**
 * Whether the process is running inside an automated CI environment, as
 * `ci-info` reads it from the process's own environment when it loads: about
 * fifty CI services, and the generic `CI` variable.
 */
class CiFlag implements Property<NodeJS.ProcessEnv, boolean> {
  public value(_env: NodeJS.ProcessEnv): boolean {
    return ci.isCI;
  }
}

export const ciFlag = new CiFlag();
