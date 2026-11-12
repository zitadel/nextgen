import type { Property } from "@/lib/telemetry/property";

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
    const named = CiProvider.providers.find(([marker]) => {
      return envEnabled(env[marker]);
    });
    if (named) {
      return named[1];
    }
    return envEnabled(env.CI) ? "unknown" : undefined;
  }
}

export const ciProvider = new CiProvider();

/**
 * Whether this runs in a CI build: the providers {@link ciProvider} recognises
 * (`CI`, or a provider's own marker such as Jenkins' `JENKINS_URL`), plus the
 * builds that set neither: Cloudflare Pages, Azure Pipelines and AWS CodeBuild.
 */
export function runsInCi(env: NodeJS.ProcessEnv): boolean {
  return (
    ciProvider.value(env) !== undefined ||
    env.CF_PAGES === "1" ||
    envEnabled(env.TF_BUILD) ||
    envEnabled(env.CODEBUILD_BUILD_ID)
  );
}
