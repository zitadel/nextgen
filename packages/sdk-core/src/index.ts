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

export type ZitadelEnvironment = "development" | "preview" | "production";

export type ZitadelRuntime = {
  projectId: string;
  environment: ZitadelEnvironment;
  issuer?: string;
};

export type ZitadelRuntimeInput = {
  projectId?: string;
  environment?: ZitadelEnvironment;
  issuer?: string;
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
    environment: parseEnvironment(env.NEXT_PUBLIC_ZITADEL_ENVIRONMENT ?? env.ZITADEL_ENVIRONMENT),
    issuer: env.NEXT_PUBLIC_ZITADEL_ISSUER ?? env.ZITADEL_ISSUER,
  });
}

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
