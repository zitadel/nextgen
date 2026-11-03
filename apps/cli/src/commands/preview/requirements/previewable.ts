import { CREDENTIALS, PREVIEW_CREDENTIAL } from "../../../lib/oclif";
import { resolveEnvironment } from "../../../lib/environment";
import { ends, requirement, unmet } from "../../../lib/oclif/requirements";
import { ciProvider } from "../../../lib/telemetry/dimensions/ci-provider";
import { envEnabled } from "../../../lib/telemetry/dimensions/env-flag";
import { reportWarning } from "../../../lib/warnings";

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

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export const previewable = requirement({
  refusal: {
    message: "{credential} is not set",
    hint: "Set {credential} for this build, or drop --strict to skip the preview when it is absent.",
  },
  resolve: async ({ flags, meta }) => {
    const environment = await resolveEnvironment({
      cwd: meta.cwd,
      env: process.env,
      serverFlag: text(flags.server),
      envName: text(flags.env),
      envFile: text(flags.envFile),
    });
    const credential = CREDENTIALS[PREVIEW_CREDENTIAL];
    const verdict = previewVerdict({
      environment: environment.name.value,
      fromDefault: environment.name.source === "default",
      ci: runsInCi(meta.env),
      credentialSet: environment.values[credential] !== undefined,
      strict: flags.strict === true,
    });
    switch (verdict) {
      case "preview":
        return {
          credential,
        };
      case "credential-required":
        return unmet({
          credential,
        });
      case "production-build":
        return ends({
          status: "skipped",
          reason: "nothing-to-preview",
          pretty: "nothing to preview — production is deployed by `zitadel deploy`, after merge",
        });
      case "unnamed-ci-build":
        reportWarning(
          "This CI build names no environment, so the preview is skipped. Set ZITADEL_ENV=preview in the pull-request build that should deploy one.",
        );
        return ends({
          status: "skipped",
          reason: "nothing-to-preview",
          pretty: "nothing to preview — set ZITADEL_ENV=preview in the pull-request build",
        });
      case "no-credential":
        reportWarning(
          `No preview credential (${credential}) is set, so the preview is skipped; a fork pull-request build cannot read it. Pass --strict to fail instead.`,
        );
        return ends({
          status: "skipped",
          reason: "no-preview-credential",
          pretty: `no preview credential (${credential}) — preview skipped`,
        });
    }
  },
});
