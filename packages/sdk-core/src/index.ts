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
} from "./middleware.js";
export { verifyJwt, decodeJwt, isJwtShaped, base64UrlDecode, JWKS_TTL_MS } from "./jwt.js";
export type { JwtPayload, JwtHeader, DecodedJwt, VerifyJwtOptions } from "./jwt.js";

export type ZitadelRuntime = {
  projectId: string;
  issuer?: string;
  /**
   * The release the build was made against, sent as `X-Zitadel-Release` so
   * the server selects it among the releases already deployed to the
   * request's target. Unset, the target's newest deployment is served.
   */
  release?: string;
};

export type ZitadelRuntimeInput = {
  projectId?: string;
  issuer?: string;
  release?: string;
};

export class ZitadelRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ZitadelRuntimeError";
    this.code = code;
  }
}

export function resolveZitadelRuntimeEnv(
  env: Record<string, string | undefined> = currentEnv(),
): ZitadelRuntime {
  return resolveZitadelRuntime({
    projectId: env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? env.ZITADEL_PROJECT_ID,
    issuer: env.NEXT_PUBLIC_ZITADEL_ISSUER ?? env.ZITADEL_ISSUER,
    release: env.NEXT_PUBLIC_ZITADEL_RELEASE ?? env.ZITADEL_RELEASE,
  });
}

export function resolveZitadelRuntime(input: ZitadelRuntimeInput): ZitadelRuntime {
  if (!input.projectId) {
    throw new ZitadelRuntimeError(
      "E_ZITADEL_CONFIG",
      "ZITADEL_PROJECT_ID is required for Zitadel runtime.",
    );
  }
  return {
    projectId: input.projectId,
    ...(input.issuer ? { issuer: input.issuer } : {}),
    ...(input.release ? { release: input.release } : {}),
  };
}

function currentEnv(): Record<string, string | undefined> {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env ?? {};
}
