import type { Property } from "../property";
import { envEnabled } from "./env-flag";

/** Whether the process is running inside an automated CI environment. */
class CiFlag implements Property<NodeJS.ProcessEnv, boolean> {
  public value(env: NodeJS.ProcessEnv): boolean {
    return envEnabled(env.CI) || envEnabled(env.GITHUB_ACTIONS) || envEnabled(env.GITLAB_CI);
  }
}

export const ciFlag = new CiFlag();
