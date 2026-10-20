import { resolveBackendUrl } from "@zitadel/sdk-core/middleware";

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * The backend URL, resolved when the server runs. A value in the runtime
 * config (`nextgen.url` in nuxt.config, or `NUXT_NEXTGEN_URL` in the
 * environment) wins, then `issuerUrl`, then `ZITADEL_URL` from the server's
 * environment, then the local default, by the rule every server SDK shares
 * ({@link resolveBackendUrl}): a blank value counts as unset. Nothing here is
 * fixed at build time.
 */
export function resolveUrl(nextgen: Record<string, unknown> | undefined): string {
  return resolveBackendUrl(text(nextgen?.url), text(nextgen?.issuerUrl), process.env.ZITADEL_URL);
}

/**
 * The project secret, resolved when the server runs: `NUXT_NEXTGEN_PROJECT_SECRET`
 * (runtime config) first, then `ZITADEL_PROJECT_SECRET` from the server's
 * environment. The module never writes it into the build, so it exists only in
 * the running server's environment.
 */
export function resolveProjectSecret(
  nextgen: Record<string, unknown> | undefined,
): string | undefined {
  return nonEmpty(nextgen?.projectSecret) ?? nonEmpty(process.env.ZITADEL_PROJECT_SECRET);
}
