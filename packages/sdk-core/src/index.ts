export type ZitadelAuthMode = "login" | "register";
export type ZitadelEnvironment = "development" | "preview" | "production";
export type ZitadelSecretKind = "project" | "preview";

export type ZitadelRuntime = {
  projectId: string;
  environment: ZitadelEnvironment;
  issuer?: string;
  secret: string;
  secretKind: ZitadelSecretKind;
};

export class ZitadelRuntimeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ZitadelRuntimeError";
    this.code = code;
  }
}

export type MockFlowField = {
  name: string;
  label: string;
  type: "text" | "email" | "password";
  required: boolean;
};

export type MockFlow = {
  mode: ZitadelAuthMode;
  title: string;
  fields: MockFlowField[];
  actions: string[];
};

export function createMockFlow(mode: ZitadelAuthMode): MockFlow {
  if (mode === "login") {
    return {
      mode,
      title: "Sign in",
      fields: [{ name: "email", label: "Email address", type: "email", required: true }],
      actions: ["Continue with passkey", "Continue with password"],
    };
  }

  return {
    mode,
    title: "Create account",
    fields: [
      { name: "email", label: "Email address", type: "email", required: true },
      { name: "given_name", label: "First name", type: "text", required: true },
      { name: "family_name", label: "Last name", type: "text", required: true },
    ],
    actions: ["Create passkey account"],
  };
}

export function mockSubmit(mode: ZitadelAuthMode, values: Record<string, FormDataEntryValue>): {
  ok: true;
  message: string;
  user: Record<string, string>;
} {
  return {
    ok: true,
    message: mode === "login" ? "Mock session created." : "Mock user registered.",
    user: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])),
  };
}

export function resolveZitadelRuntimeEnv(env: Record<string, string | undefined> = currentEnv()): ZitadelRuntime {
  const projectId = requireEnv(env, "ZITADEL_PROJECT_ID");
  const environment = parseEnvironment(env.ZITADEL_ENVIRONMENT);
  const issuer = env.ZITADEL_ISSUER;

  if (environment === "preview") {
    return {
      projectId,
      environment,
      issuer,
      secret: requireEnv(env, "ZITADEL_PREVIEW_SECRET"),
      secretKind: "preview",
    };
  }

  const projectSecret = requireEnv(env, "ZITADEL_PROJECT_SECRET");
  if (environment === "production" && !issuer) {
    throw new ZitadelRuntimeError(
      "E_ZITADEL_CONFIG",
      "ZITADEL_ISSUER is required in production. Run `npx zitadel@latest claim` before production deploys.",
    );
  }

  return {
    projectId,
    environment,
    issuer,
    secret: projectSecret,
    secretKind: "project",
  };
}

function parseEnvironment(value: string | undefined): ZitadelEnvironment {
  if (!value || value === "development") return "development";
  if (value === "preview" || value === "production") return value;
  throw new ZitadelRuntimeError("E_ZITADEL_CONFIG", `Unsupported ZITADEL_ENVIRONMENT "${value}".`);
}

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
