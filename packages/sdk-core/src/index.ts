export type {
  ZitadelAuthSession,
  AuthState,
  UnauthState,
  AuthResult,
  ZitadelMiddlewareOptions,
} from "./middleware.js";
export {
  HOP_BY_HOP,
  INTERNAL_HEADERS,
  matchesRoutes,
  filterResponseHeaders,
  requiresProjectSecret,
  checkOpaqueSessionToken,
  validateOpaqueSessionToken,
  jwtNamesProject,
  resolveSession,
  SESSION_PROJECT_MISMATCH,
  SERVER_SESSION_COOKIE,
  serverSessionCookieName,
  sessionCookieName,
  serializeSessionCookie,
  proxySessionCookies,
  clearSessionCheckCache,
  SESSION_COOKIE_CACHE_CONTROL,
} from "./middleware.js";
export type {
  OpaqueSession,
  OpaqueSessionCheck,
  SessionRequest,
  SessionCookie,
  ResolveSessionOptions,
  ResolvedSession,
  ProxiedRequest,
  ProxiedAnswer,
  ProxiedSessionCookies,
  ProxyUpstream,
  BrowserRequest,
} from "./middleware.js";
export {
  verifyJwt,
  decodeJwt,
  isJwtShaped,
  base64UrlDecode,
  JWKS_TTL_MS,
  JWKS_MIN_REFRESH_MS,
  clearJwksCache,
} from "./jwt.js";
export type { JwtPayload, JwtHeader, DecodedJwt, VerifyJwtOptions } from "./jwt.js";

/**
 * The deployment stage an app runs in.
 *
 * Only `production` demands an issuer, because a deployed app must name the auth backend it trusts
 * while a local app can fall back to a development server. The stage is `development` when nothing
 * names one.
 *
 * @see {@link resolveZitadelRuntime}
 */
export type ZitadelEnvironment = "development" | "preview" | "production";

/**
 * The resolved runtime configuration: the project an app signs users in to and where it runs.
 *
 * {@link resolveZitadelRuntime} produces it, so every field has been validated. Use it instead of
 * reading environment variables by hand, so that a missing value fails at startup and not on the
 * first request.
 */
export type ZitadelRuntime = {
  /**
   * The project id that the app signs its users in to.
   */
  projectId: string;
  /**
   * The stage that the app runs in.
   */
  environment: ZitadelEnvironment;
  /**
   * The issuer URL of the auth backend.
   *
   * It is always set in `production` and optional in the other stages.
   */
  issuer?: string;
};

/**
 * The unvalidated values that {@link resolveZitadelRuntime} turns into a {@link ZitadelRuntime}.
 *
 * Every field is optional, because each usually comes from an environment variable that may be
 * unset.
 */
export type ZitadelRuntimeInput = {
  /**
   * The project id.
   *
   * Resolution throws a {@link ZitadelRuntimeError} when it is missing or empty.
   */
  projectId?: string;
  /**
   * The stage.
   *
   * Resolution falls back to `development` when it is unset.
   */
  environment?: ZitadelEnvironment;
  /**
   * The issuer URL of the auth backend.
   *
   * It is required when the {@link ZitadelRuntimeInput.environment} is `production`.
   */
  issuer?: string;
};

/**
 * The error thrown when the runtime cannot be resolved.
 *
 * The causes are a missing project id, a missing issuer in production, and an unknown environment
 * name. It fails startup loudly, so an app never runs unconfigured: an app without a project id
 * would otherwise treat every session as signed out and look broken for no visible reason.
 *
 * @example
 * ```ts
 * try {
 *   resolveZitadelRuntimeEnv();
 * } catch (error) {
 *   if (error instanceof ZitadelRuntimeError) {
 *     console.error(error.code, error.message);
 *   }
 * }
 * ```
 */
export class ZitadelRuntimeError extends Error {
  /**
   * A stable machine-readable code.
   *
   * It is `E_ZITADEL_CONFIG` for every cause today, so branch on it and not on the message.
   */
  readonly code: string;

  /**
   * Creates the error with its stable code.
   *
   * @param code - The stable error code.
   * @param message - What is wrong and which variable fixes it.
   */
  constructor(code: string, message: string) {
    super(message);
    this.name = "ZitadelRuntimeError";
    this.code = code;
  }
}

/**
 * Resolves the runtime from environment variables.
 *
 * It reads `ZITADEL_PROJECT_ID`, `ZITADEL_ENVIRONMENT` and `ZITADEL_ISSUER`. The public variable,
 * the one with the `NEXT_PUBLIC_` prefix, wins over the plain one. A framework that inlines public
 * variables into the client bundle and a server that reads only the plain ones therefore agree on
 * one value.
 *
 * On a runtime without `process`, such as an edge worker, the default environment is empty and the
 * call throws, so pass the variables in explicitly there.
 *
 * @param env - The variables to read. Defaults to `process.env` where that exists and to an empty
 * set on runtimes without it.
 * @returns The validated runtime.
 * @throws {@link ZitadelRuntimeError} When {@link resolveZitadelRuntime} rejects the values, or
 * when the environment name is not `development`, `preview` or `production`.
 *
 * @example
 * ```ts
 * import { resolveZitadelRuntimeEnv } from "@zitadel/sdk-core";
 *
 * const runtime = resolveZitadelRuntimeEnv({
 *   ZITADEL_PROJECT_ID: "296547382910273",
 *   ZITADEL_ENVIRONMENT: "production",
 *   ZITADEL_ISSUER: "https://auth.example.com",
 * });
 * ```
 */
export function resolveZitadelRuntimeEnv(
  env: Record<string, string | undefined> = currentEnv(),
): ZitadelRuntime {
  return resolveZitadelRuntime({
    projectId: env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? env.ZITADEL_PROJECT_ID,
    environment: parseEnvironment(env.NEXT_PUBLIC_ZITADEL_ENVIRONMENT ?? env.ZITADEL_ENVIRONMENT),
    issuer: env.NEXT_PUBLIC_ZITADEL_ISSUER ?? env.ZITADEL_ISSUER,
  });
}

/**
 * Validates runtime values and applies defaults.
 *
 * Use it when the values do not come from environment variables, for example from a config file.
 * An empty project id counts as missing.
 *
 * @param input - The values to validate.
 * @returns The runtime, with the environment defaulted to `development`.
 * @throws {@link ZitadelRuntimeError} When the project id is missing, or when the environment is
 * `production` and the issuer is missing.
 *
 * @example
 * ```ts
 * const runtime = resolveZitadelRuntime({ projectId: "296547382910273" });
 * // { projectId: "296547382910273", environment: "development", issuer: undefined }
 * ```
 */
export function resolveZitadelRuntime(input: ZitadelRuntimeInput): ZitadelRuntime {
  const environment = input.environment ?? "development";
  if (!input.projectId) {
    throw new ZitadelRuntimeError(
      "E_ZITADEL_CONFIG",
      "ZITADEL_PROJECT_ID is required for Zitadel runtime.",
    );
  }
  if (environment === "production" && !input.issuer) {
    throw new ZitadelRuntimeError("E_ZITADEL_CONFIG", "ZITADEL_ISSUER is required in production.");
  }
  return {
    projectId: input.projectId,
    environment,
    issuer: input.issuer,
  };
}

/**
 * Parses the name of an environment, treating an empty value as `development`.
 *
 * @param value - The raw variable value.
 * @returns The environment.
 * @throws {@link ZitadelRuntimeError} When the name is not a known environment.
 */
function parseEnvironment(value: string | undefined): ZitadelEnvironment {
  if (!value || value === "development") return "development";
  if (value === "preview" || value === "production") return value;
  throw new ZitadelRuntimeError("E_ZITADEL_CONFIG", `Unsupported ZITADEL_ENVIRONMENT "${value}".`);
}

/**
 * Returns the process environment where it exists, and an empty set on runtimes without `process`.
 *
 * @returns The variables.
 */
function currentEnv(): Record<string, string | undefined> {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env ?? {};
}
