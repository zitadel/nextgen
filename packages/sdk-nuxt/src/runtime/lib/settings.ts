/** Where `zitadel start` runs the local server by default. */
export const DEFAULT_URL = "http://localhost:8080";

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * The backend URL, resolved when the server runs. A value in the runtime
 * config (`nextgen.url` in nuxt.config, or `NUXT_NEXTGEN_URL` in the
 * environment) wins, then `ZITADEL_URL` from the server's environment, then
 * the local default. Nothing here is fixed at build time.
 */
export function resolveUrl(nextgen: Record<string, unknown> | undefined): string {
  return (
    nonEmpty(nextgen?.url) ??
    nonEmpty(nextgen?.issuerUrl) ??
    nonEmpty(process.env.ZITADEL_URL) ??
    DEFAULT_URL
  );
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
