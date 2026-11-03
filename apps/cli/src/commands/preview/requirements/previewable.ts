import { CREDENTIALS, PREVIEW_CREDENTIAL } from "../../../lib/oclif";
import { resolveEnvironment } from "../../../lib/environment";
import { ends, requirement, unmet } from "../../../lib/oclif/requirements";
import { reportWarning } from "../../../lib/warnings";
import { previewVerdict, runsInCi } from "../verdict";

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
