import { DEFAULT_ZITADEL_URL, nonEmpty, resolveZitadelUrl } from "@zitadel/sdk-core/middleware";

/**
 * The backend URL used when no other source names one.
 *
 * It is where `zitadel start` runs the local server, so a fresh app works against a local server
 * with no configuration. Nitro stores a runtime-config key the app left unset as an empty string,
 * so an empty value counts as unset, as it does in every server SDK.
 */
export const DEFAULT_URL = DEFAULT_ZITADEL_URL;

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
  return resolveZitadelUrl(zitadel?.url, zitadel?.issuerUrl, process.env.ZITADEL_URL);
}

/**
 * Resolves the project secret when the server runs.
 *
 * `NUXT_ZITADEL_PROJECT_SECRET` (the runtime config) wins, then `ZITADEL_PROJECT_SECRET` from the
 * server's environment. The module never writes the secret into the build, so it exists only in
 * the running server's environment and never reaches the build output or the browser. A
 * `projectSecret` passed to {@link createZitadelMiddleware} by hand is the explicit choice of the
 * app and comes first.
 *
 * @param zitadel - The private `runtimeConfig.zitadel` object, or `undefined` where it is not
 *   available.
 * @param option - The `projectSecret` option of the middleware, or `undefined` when none is set.
 * @returns The secret, or `undefined` when none is set. The proxy then sends no bearer.
 */
export function resolveProjectSecret(
  zitadel: Record<string, unknown> | undefined,
  option?: string,
): string | undefined {
  return (
    nonEmpty(option) ??
    nonEmpty(zitadel?.projectSecret) ??
    nonEmpty(process.env.ZITADEL_PROJECT_SECRET)
  );
}
