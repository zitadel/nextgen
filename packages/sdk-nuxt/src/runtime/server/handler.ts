import type { ZitadelMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { useRuntimeConfig } from "#imports";

import { resolveUrl } from "../lib/settings";
import { createZitadelMiddleware } from "./middleware";

/**
 * Narrows a value to a non-empty string.
 *
 * @param value - The value to check.
 * @returns The value when it is a non-empty string, otherwise `undefined`.
 */
function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * Reads a list of strings from a runtime-config value.
 *
 * A single non-empty string counts as a one-entry list, because an environment variable that is
 * not valid JSON arrives as a plain string.
 *
 * @param value - The value to read.
 * @returns The list, or `undefined` when the value is empty or of another type.
 */
function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  const single = nonEmptyString(value);
  return single === undefined ? undefined : [single];
}

/**
 * Narrows a value to a finite number.
 *
 * @param value - The value to check.
 * @returns The value when it is a finite number, otherwise `undefined`.
 */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Turns the module's `runtimeConfig.zitadel` into middleware options.
 *
 * Nitro stores an option the app left unset as an empty string, which keeps it settable at
 * run time through a `NUXT_ZITADEL_<NAME>` environment variable. Those variables arrive parsed:
 * a JSON list becomes a list, a number becomes a number, anything else stays a string. So an
 * empty string, or a value of the wrong type, counts as unset and the middleware's own default
 * applies. Passed through, an empty string would make every timeout zero and would reject every
 * token for the audience `""`.
 *
 * The project id is `zitadel.projectId`, then the public project id the widgets sign users in
 * to. With neither, the middleware falls back to `ZITADEL_PROJECT_ID`. A session counts only in
 * that project. The `jwtKey` option is not passed on, because offline verification is reserved
 * and unused.
 *
 * @param zitadel - The private `runtimeConfig.zitadel` object. Defaults to an empty object.
 * @param publicConfig - The `runtimeConfig.public` object, for the public project id. Defaults
 *   to an empty object.
 * @returns The options for {@link createZitadelMiddleware}.
 */
export function middlewareOptions(
  zitadel: Record<string, unknown> = {},
  publicConfig: Record<string, unknown> = {},
): ZitadelMiddlewareOptions {
  return {
    url: resolveUrl(zitadel),
    // Sessions are held to this project; with none set, to the public project
    // id the widgets sign users in to, and with neither, to ZITADEL_PROJECT_ID
    // (the middleware's own default).
    projectId: nonEmptyString(zitadel.projectId) ?? nonEmptyString(publicConfig.zitadelProjectId),
    proxyPath: nonEmptyString(zitadel.proxyPath) ?? "/__nextgen",
    loginPath: nonEmptyString(zitadel.loginPath) ?? "/login",
    protectedRoutes: stringList(zitadel.protectedRoutes) ?? [],
    ignoredRoutes: stringList(zitadel.ignoredRoutes),
    allowedAlgorithms: stringList(zitadel.allowedAlgorithms),
    allowedTokenTypes: stringList(zitadel.allowedTokenTypes),
    audience: stringList(zitadel.audience),
    clockSkewMs: finiteNumber(zitadel.clockSkewMs),
    jwksTimeoutMs: finiteNumber(zitadel.jwksTimeoutMs),
    proxyTimeoutMs: finiteNumber(zitadel.proxyTimeoutMs),
    opaqueTokenTimeoutMs: finiteNumber(zitadel.opaqueTokenTimeoutMs),
  };
}

const config = useRuntimeConfig() as {
  zitadel?: Record<string, unknown>;
  public?: Record<string, unknown>;
};

/**
 * The global Nitro event handler that the module registers as server middleware.
 *
 * It builds {@link createZitadelMiddleware} from the runtime config once, when the server starts,
 * so an app that uses the module does not write its own `server/middleware` file. Because the
 * options come from `runtimeConfig.zitadel`, the `zitadel` key in `nuxt.config.ts` and the
 * `NUXT_ZITADEL_*` environment variables both reach it.
 */
export default createZitadelMiddleware(middlewareOptions(config.zitadel, config.public));
