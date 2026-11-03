import { resolveEnvironment } from "../../../../../lib/environment";
import { requirement } from "../../../../../lib/oclif/requirements";

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The origin the app serves from, as the run's environment names it. A
 * Project that has none has not been set up.
 */
export const developmentIssuer = requirement<string>({
  refusal: {
    message: "This Project has no development issuer",
    hint: "Run `zitadel setup` first, or set ZITADEL_ISSUER to the origin your app serves from.",
  },
  resolve: async ({ flags, meta }) => {
    const environment = await resolveEnvironment({
      cwd: meta.cwd,
      env: process.env,
      serverFlag: text(flags.server),
      envName: text(flags.env),
      envFile: text(flags.envFile),
    });
    return environment.values.ZITADEL_ISSUER?.value;
  },
});
