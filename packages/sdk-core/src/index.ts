export type {
  NextgenSession,
  AuthState,
  UnauthState,
  AuthResult,
  NextgenMiddlewareOptions,
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
 * The deployment stage an app runs in. `production` is the only stage that
 * demands an issuer (see {@link resolveZitadelRuntime}); `development` is the
 * default when nothing names a stage.
 */
export type ZitadelEnvironment = "development" | "preview" | "production";

/**
 * The resolved runtime configuration: the project an app signs users in to and
 * where it runs. Produced by {@link resolveZitadelRuntime}, so every field has
 * been validated.
 */
export type ZitadelRuntime = {
  /** The project this app signs its users in to. */
  projectId: string;
  /** The stage the app runs in. */
  environment: ZitadelEnvironment;
  /** The issuer URL of the auth backend; always set in `production`, optional elsewhere. */
  issuer?: string;
};

/**
 * The unvalidated values {@link resolveZitadelRuntime} turns into a
 * {@link ZitadelRuntime}. Every field is optional because each usually comes
 * from an environment variable that may be unset.
 */
export type ZitadelRuntimeInput = {
  /** The project id; resolution throws {@link ZitadelRuntimeError} when it is missing. */
  projectId?: string;
  /** The stage; resolution falls back to `development` when it is unset. */
  environment?: ZitadelEnvironment;
  /** The issuer URL; required when `environment` is `production`. */
  issuer?: string;
};

/**
 * Thrown when the runtime cannot be resolved: a missing project id, a missing
 * issuer in production, or an unknown environment name. It fails startup
 * loudly rather than letting an app run unconfigured.
 */
export class ZitadelRuntimeError extends Error {
  /** A stable machine-readable code; always `E_ZITADEL_CONFIG` today. */
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
 * Resolves the runtime from environment variables. The public
 * (`NEXT_PUBLIC_`-prefixed) variable wins over the plain one so a framework
 * that inlines public variables into the client bundle and a server that reads
 * only the plain ones agree on one value. Reads `ZITADEL_PROJECT_ID`,
 * `ZITADEL_ENVIRONMENT` and `ZITADEL_ISSUER`.
 *
 * @param env - The variables to read; defaults to `process.env` where that
 * exists and to an empty set on runtimes without it (edge workers).
 * @returns The validated runtime.
 * @throws {@link ZitadelRuntimeError} When {@link resolveZitadelRuntime} rejects the values.
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
 * @param input - The values to validate.
 * @returns The runtime, with `environment` defaulted to `development`.
 * @throws {@link ZitadelRuntimeError} When `projectId` is missing, or when the
 * environment is `production` and `issuer` is missing.
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

function parseEnvironment(value: string | undefined): ZitadelEnvironment {
  if (!value || value === "development") return "development";
  if (value === "preview" || value === "production") return value;
  throw new ZitadelRuntimeError("E_ZITADEL_CONFIG", `Unsupported ZITADEL_ENVIRONMENT "${value}".`);
}

function currentEnv(): Record<string, string | undefined> {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env ?? {};
}
