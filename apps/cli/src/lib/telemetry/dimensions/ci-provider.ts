import type { Property } from "../property";
import { envEnabled } from "./env-flag";

/** Coarse CI provider name, or `undefined` when not running in CI. */
class CiProvider implements Property<NodeJS.ProcessEnv, string | undefined> {
  /** Provider-marker env var → reported name, in match order. */
  private static readonly providers = [
    ["GITHUB_ACTIONS", "github_actions"],
    ["GITLAB_CI", "gitlab_ci"],
    ["CIRCLECI", "circleci"],
    ["BUILDKITE", "buildkite"],
    ["JENKINS_URL", "jenkins"],
  ] as const satisfies ReadonlyArray<readonly [string, string]>;

  public value(env: NodeJS.ProcessEnv): string | undefined {
    const named = CiProvider.providers.find(([marker]) => envEnabled(env[marker]));
    if (named) {
      return named[1];
    }
    return envEnabled(env.CI) ? "unknown" : undefined;
  }
}

export const ciProvider = new CiProvider();
