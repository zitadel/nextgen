import type { Property } from "../property";
import { envEnabled } from "./env-flag";

/** Coarse CI provider name, or `undefined` when not running in CI. */
class CiProvider implements Property<NodeJS.ProcessEnv, string | undefined> {
  public value(env: NodeJS.ProcessEnv): string | undefined {
    if (envEnabled(env.GITHUB_ACTIONS)) {
      return "github_actions";
    }
    if (envEnabled(env.GITLAB_CI)) {
      return "gitlab_ci";
    }
    if (envEnabled(env.CIRCLECI)) {
      return "circleci";
    }
    if (envEnabled(env.BUILDKITE)) {
      return "buildkite";
    }
    if (env.JENKINS_URL) {
      return "jenkins";
    }
    return envEnabled(env.CI) ? "unknown" : undefined;
  }
}

export const ciProvider = new CiProvider();
