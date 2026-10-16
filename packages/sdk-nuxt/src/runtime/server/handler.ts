import type { NextgenMiddlewareOptions } from "@zitadel/sdk-core/middleware";

import { useRuntimeConfig } from "#imports";

import { createNextgenMiddleware } from "./middleware";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** A list of strings; a single string counts as a one-entry list. */
function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  const single = nonEmptyString(value);
  return single === undefined ? undefined : [single];
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Turns the module's `runtimeConfig.nextgen` into middleware options. Nitro
 * stores an option the app left unset as `""`, which keeps it settable at
 * runtime through `NUXT_NEXTGEN_*`, and those variables arrive parsed (a JSON
 * list, a number, else a string). So `""` or a value of the wrong type counts
 * as unset, and the middleware's own default applies: passed through, `""`
 * would make every timeout zero and reject every token for audience `""`.
 */
export function middlewareOptions(
  nextgen: Record<string, unknown> = {},
): NextgenMiddlewareOptions & { projectSecret?: string } {
  return {
    url:
      nonEmptyString(nextgen.url) ?? nonEmptyString(nextgen.issuerUrl) ?? "http://localhost:8080",
    proxyPath: nonEmptyString(nextgen.proxyPath) ?? "/__nextgen",
    loginPath: nonEmptyString(nextgen.loginPath) ?? "/login",
    protectedRoutes: stringList(nextgen.protectedRoutes) ?? [],
    ignoredRoutes: stringList(nextgen.ignoredRoutes),
    allowedAlgorithms: stringList(nextgen.allowedAlgorithms),
    allowedTokenTypes: stringList(nextgen.allowedTokenTypes),
    audience: stringList(nextgen.audience),
    clockSkewMs: finiteNumber(nextgen.clockSkewMs),
    jwksTimeoutMs: finiteNumber(nextgen.jwksTimeoutMs),
    proxyTimeoutMs: finiteNumber(nextgen.proxyTimeoutMs),
    opaqueTokenTimeoutMs: finiteNumber(nextgen.opaqueTokenTimeoutMs),
    projectSecret: nonEmptyString(nextgen.projectSecret),
  };
}

const config = useRuntimeConfig() as { nextgen?: Record<string, unknown> };

/**
 * Default Nitro/H3 event handler registered by the `@zitadel/sdk-nuxt` module
 * via {@link addServerHandler}. Reads middleware options from Nuxt runtime
 * config (`nuxt.config.ts → nextgen`) so consumers do not need to create
 * their own `server/middleware/auth.ts` when using the module.
 */
export default createNextgenMiddleware(middlewareOptions(config.nextgen));
