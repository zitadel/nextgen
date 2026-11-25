/**
 * The backend URL used when no other source names one.
 *
 * It is where `zitadel start` runs the local server, so a fresh app works against a local server
 * with no configuration. Nitro stores a runtime-config key the app left unset as an empty string,
 * so an empty value counts as unset, as it does in every server SDK.
 */
export const DEFAULT_URL = "http://localhost:8080";

/**
 * The process environment, or an empty map when there is none.
 *
 * `process` is undefined in some edge and serverless runtimes, so the environment is read
 * defensively and the fallback never throws a `ReferenceError`.
 */
const PROCESS_ENV: Record<string, string | undefined> =
  typeof process !== "undefined" && process.env ? process.env : {};

/**
 * Narrows a value to a string, because Nitro hands runtime-config values over as `unknown`.
 *
 * @param value - The value to narrow.
 * @returns The value when it is a string, otherwise an empty string, so `||` treats it as unset.
 */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  return text(zitadel?.url) || text(zitadel?.issuerUrl) || PROCESS_ENV.ZITADEL_URL || DEFAULT_URL;
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
  return option || text(zitadel?.projectSecret) || PROCESS_ENV.ZITADEL_PROJECT_SECRET || undefined;
}
