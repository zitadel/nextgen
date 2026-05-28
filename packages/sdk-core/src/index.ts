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
    throw new ZitadelRuntimeError(
      "E_ZITADEL_CONFIG",
      "ZITADEL_ISSUER is required in production.",
    );
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

// @ts-expect-error will be used later
// oxlint-disable-next-line no-unused-vars
function requireEnv(env: Record<string, string | undefined>, key: string): string {
  const value = env[key];
  if (!value) {
    throw new ZitadelRuntimeError("E_ZITADEL_CONFIG", `${key} is required for Zitadel runtime.`);
  }
  return value;
}

function currentEnv(): Record<string, string | undefined> {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env ?? {};
}
