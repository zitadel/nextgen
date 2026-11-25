/**
 * The backend URL used when no other source names one.
 *
 * It is where `zitadel start` runs the local server, so a fresh app works against a local server
 * with no configuration.
 */
export const DEFAULT_URL = "http://localhost:8080";

/**
 * Narrows a value to a non-empty string.
 *
 * Nitro stores a runtime-config key the app left unset as an empty string, so an empty string
 * has to count as unset.
 *
 * @param value - The value to check.
 * @returns The value when it is a non-empty string, otherwise `undefined`.
 */
function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Resolves the Zitadel backend URL when the server runs.
 *
 * A value in the runtime config wins (`zitadel.url` in `nuxt.config.ts`, or `NUXT_ZITADEL_URL` in
 * the environment). Then comes `ZITADEL_URL` from the server's environment, then
 * {@link DEFAULT_URL}. Nothing here is fixed at build time, so one build can serve every
 * environment. An empty value counts as unset.
 *
 * @param zitadel - The private `runtimeConfig.zitadel` object, or `undefined` where it is not
 *   available.
 * @returns The backend URL, never empty.
 */
export function resolveUrl(zitadel: Record<string, unknown> | undefined): string {
  return (
    nonEmpty(zitadel?.url) ??
    nonEmpty(zitadel?.issuerUrl) ??
    nonEmpty(process.env.ZITADEL_URL) ??
    DEFAULT_URL
  );
}

/**
 * Resolves the project secret when the server runs.
 *
 * `NUXT_ZITADEL_PROJECT_SECRET` (the runtime config) wins, then `ZITADEL_PROJECT_SECRET` from the
 * server's environment. The module never writes the secret into the build, so it exists only in
 * the running server's environment and never reaches the build output or the browser.
 *
 * @param zitadel - The private `runtimeConfig.zitadel` object, or `undefined` where it is not
 *   available.
 * @returns The secret, or `undefined` when none is set. The proxy then sends no bearer.
 */
export function resolveProjectSecret(
  zitadel: Record<string, unknown> | undefined,
): string | undefined {
  return nonEmpty(zitadel?.projectSecret) ?? nonEmpty(process.env.ZITADEL_PROJECT_SECRET);
}
