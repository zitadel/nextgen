/**
 * Whether a build has a preview to deploy, decided from the environment alone.
 * Kept beside the command rather than in its requirement so the decision can
 * be read, and tested, as the table of cases it is.
 */
import { ciProvider } from "../../lib/telemetry/dimensions/ci-provider";
import { envEnabled } from "../../lib/telemetry/dimensions/env-flag";

/** Why a preview is skipped, or refused, instead of deployed. */
export type PreviewVerdict =
  | "preview"
  | "production-build"
  | "unnamed-ci-build"
  | "no-credential"
  | "credential-required";

/**
 * Whether this build has a preview to deploy. Only a preview or development
 * build does: a production build serves the release `zitadel deploy` published
 * after merge. The environment gates this, not `--origin`, which only selects
 * the targets and never authorizes a preview deploy into an environment that
 * must not take writes. In a CI build `development` is only a platform the
 * resolver cannot read, so it is skipped rather than taken for a preview. A
 * fork pull-request build cannot read the preview credential, so a missing one
 * skips the preview and the build carries on (#1312); `--strict` refuses
 * instead, for a trusted build that expects it.
 */
export function previewVerdict(input: {
  environment: string;
  fromDefault: boolean;
  ci: boolean;
  credentialSet: boolean;
  strict: boolean;
}): PreviewVerdict {
  if (input.environment !== "preview" && input.environment !== "development") {
    return "production-build";
  }
  if (input.fromDefault && input.ci) {
    return "unnamed-ci-build";
  }
  if (input.credentialSet) {
    return "preview";
  }
  return input.strict ? "credential-required" : "no-credential";
}

/**
 * Whether this runs in a CI build: the providers the CLI already recognises
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
