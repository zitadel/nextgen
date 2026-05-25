import { stableStringify } from "../../../../json";
import { DEFAULT_SERVER } from "../../../../platform/resolve-server";
import type { CreateProjectResponse } from "../../../../platform/schemas";
import type { PackageManager } from "../../../../detect/package-manager";
import type { PatchContext, Patcher } from "../types";
import type { ScaffoldResult } from "./file-writer/plan";
import type { ScaffoldPlan } from "./file-writer/plan";
import { scaffold } from "./file-writer";
import { NextAdapter } from "./next/adapter";
import { getRenderer } from "./next/renderers/registry";
import type { ProjectContext, ZitadelConfig } from "./types";

const DEFAULT_USER_SCHEMA_URI =
  "https://raw.githubusercontent.com/zitadel/nextgen/refs/heads/main/api/openapi/endpoints/schemas/human-user.yaml";

/** The rule-based patcher that integrates Zitadel into Next.js App Router projects. */
export class LegacyPatcher implements Patcher {
  /** Returns true for Next.js projects. */
  canPatch(framework: string): boolean {
    return framework === "next";
  }

  /**
   * Applies the full Zitadel integration to the project: writes base config files
   * (.zitadel/, zitadel.json, .env files, state) and framework-specific routes,
   * then executes the combined plan against the filesystem.
   */
  async patch(ctx: PatchContext): Promise<ScaffoldResult> {
    const renderer = getRenderer(ctx.rendererId);
    const config = buildProjectConfig(
      ctx.project,
      ctx.issuer,
      ctx.framework.id,
      ctx.server,
      ctx.rendererId,
    );
    const flow = buildFlowDefinition(ctx.userFields, ctx.authMethods);
    const locale = buildLocaleSeed(ctx.userFields, ctx.authMethods);

    const zitadelConfig: ZitadelConfig = {
      project_id: ctx.project.id,
      issuer: ctx.issuer,
      preview_origins: ctx.project.previewOrigins,
      userSchemaPath: ".zitadel/schemas/user.json",
    };

    const adapterCtx: ProjectContext = {
      cwd: ctx.cwd,
      packageManager: ctx.packageManager,
      framework: ctx.framework,
      renderer,
      config: zitadelConfig,
      isInitialSetup: true,
    };

    const adapter = new NextAdapter();
    const adapterPlan = await adapter.planSetup(adapterCtx);
    const base = buildBasePlan({
      project: ctx.project,
      config,
      userSchema: ctx.userSchema,
      flow,
      locale,
      packageManager: ctx.packageManager,
      framework: ctx.framework.id,
      issuer: ctx.issuer,
      devPort: ctx.devPort,
      server: ctx.server,
    });

    const merged = mergePlans(base, adapterPlan);
    return scaffold(merged, { cwd: ctx.cwd, dryRun: ctx.dryRun, force: ctx.force });
  }
}

function buildBasePlan(input: {
  project: CreateProjectResponse;
  config: Record<string, unknown>;
  userSchema: unknown;
  flow: Record<string, unknown>;
  locale: Record<string, string>;
  packageManager: PackageManager;
  framework: string;
  issuer: string;
  devPort: number;
  server: string;
}): ScaffoldPlan {
  return {
    ops: [
      { kind: "mkdir", path: ".zitadel", mode: 0o700 },
      { kind: "mkdir", path: ".zitadel/flows" },
      { kind: "mkdir", path: ".zitadel/schemas" },
      { kind: "mkdir", path: ".zitadel/locales" },
      { kind: "append-gitignore", entries: [".zitadel/secret", ".env*", "!.env.example"] },
      {
        kind: "write",
        path: ".zitadel/secret",
        mode: 0o600,
        contents: `${stableStringify({
          project_id: input.project.id,
          project_secret: input.project.projectSecret,
          preview_secret: input.project.previewSecret,
          preview_origins: input.project.previewOrigins,
          created_at: input.project.createdAt,
        })}\n`,
      },
      { kind: "write", path: "zitadel.json", contents: `${stableStringify(input.config)}\n` },
      {
        kind: "write",
        path: ".zitadel/schemas/user.json",
        contents: `${stableStringify(input.userSchema)}\n`,
      },
      {
        kind: "write",
        path: ".zitadel/flows/default.json",
        contents: `${stableStringify(input.flow)}\n`,
      },
      {
        kind: "write",
        path: ".zitadel/locales/en.json",
        contents: `${stableStringify(input.locale)}\n`,
      },
      {
        kind: "merge-env",
        path: ".env.example",
        entries: {
          ZITADEL_PROJECT_ID: "",
          ZITADEL_ENVIRONMENT: "",
          ZITADEL_ISSUER: "",
          NEXT_PUBLIC_ZITADEL_API_BASE: "",
          NEXT_PUBLIC_ZITADEL_PROJECT_ID: "",
        },
      },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: {
          ZITADEL_PROJECT_ID: input.project.id,
          ZITADEL_ENVIRONMENT: "development",
          ZITADEL_ISSUER: input.issuer,
          NEXT_PUBLIC_ZITADEL_API_BASE: input.server,
          NEXT_PUBLIC_ZITADEL_PROJECT_ID: input.project.id,
        },
      },
      {
        kind: "write",
        path: ".zitadel/state.json",
        contents: `${stableStringify({
          framework: input.framework,
          resources: {},
        })}\n`,
      },
    ],
    summary: [
      {
        title: "Zitadel config",
        detail: "Created local config, schema, flows, env, and secret files.",
      },
    ],
  };
}

function buildProjectConfig(
  project: CreateProjectResponse,
  issuer: string,
  framework: string,
  source: string,
  renderer: string,
): Record<string, unknown> {
  const environments: Record<string, unknown> = {
    development: { issuer },
  };
  if (project.previewOrigins.length > 0) {
    environments.preview = {
      issuer_pattern: project.previewOrigins.map((origin) => `https://${origin}`),
    };
  }

  return {
    $schema: "https://schemas.zitadel.com/v2/project.schema.json",
    project: project.id,
    server: resolveDefaultServer(source),
    framework: { id: framework },
    branding: {
      renderer,
      attribution: "visible",
    },
    environments,
  };
}

function resolveDefaultServer(source: string): string {
  try {
    return new URL(source).origin;
  } catch {
    return DEFAULT_SERVER;
  }
}

function buildFlowDefinition(
  fields: readonly string[],
  authMethods: readonly string[],
): Record<string, unknown> {
  const registerFields: Record<string, Record<string, unknown>> = {};
  for (const field of fields) {
    registerFields[field] = {
      type: fieldTypeFor(field),
      text_key: `register_profile.field.${field}`,
      required: true,
    };
  }

  const credentialActions: Record<string, Record<string, unknown>> = {
    submit: { text_key: "credential.action.submit", primary: true },
  };
  if (authMethods.includes("password")) {
    credentialActions.forgot = { text_key: "credential.action.forgot" };
  }

  return {
    name: "default",
    user_schema: DEFAULT_USER_SCHEMA_URI,
    purposes: ["login", "register"],
    initial_steps: {
      login: "identifier",
      register: "register_profile",
    },
    steps: [
      {
        name: "identifier",
        type: "identifier",
        texts: { title_key: "identifier.title" },
        fields: {
          email: {
            type: "email",
            text_key: "identifier.field.email",
            required: true,
          },
        },
        actions: {
          submit: { text_key: "identifier.action.submit", primary: true },
          register: { text_key: "identifier.action.register" },
        },
        gates: {},
        transitions: {
          submit: "credential",
          register: { pivot: "register" },
        },
      },
      {
        name: "credential",
        type: "credential",
        texts: { title_key: "credential.title" },
        fields: authMethods.includes("password")
          ? {
              password: {
                type: "password",
                text_key: "credential.field.password",
                required: true,
              },
            }
          : {},
        actions: credentialActions,
        gates: {},
        transitions: {
          submit: "complete",
          forgot: { pivot: "recovery" },
        },
      },
      {
        name: "register_profile",
        type: "form",
        texts: { title_key: "register_profile.title" },
        fields: registerFields,
        actions: {
          submit: { text_key: "register_profile.action.submit", primary: true },
          login: { text_key: "register_profile.action.login" },
        },
        gates: {},
        transitions: {
          submit: "complete",
          login: { pivot: "login" },
        },
      },
      {
        name: "complete",
        type: "complete",
        texts: { title_key: "complete.title" },
        fields: {},
        actions: {},
        gates: {},
      },
    ],
  };
}

function fieldTypeFor(field: string): string {
  if (field === "email") {
    return "email";
  }
  if (field === "phone") {
    return "tel";
  }
  if (field === "password") {
    return "password";
  }
  if (field === "date_of_birth" || field === "birthdate") {
    return "date";
  }
  return "text";
}

/** Builds the locale seed map for the default flow definition. */
export function buildLocaleSeed(
  fields: readonly string[],
  authMethods: readonly string[],
): Record<string, string> {
  const base: Record<string, string> = {
    "identifier.title": "Sign in",
    "identifier.field.email": "Email address",
    "identifier.action.submit": "Continue",
    "identifier.action.register": "Create account",
    "credential.title": "Enter your credential",
    "credential.action.submit": "Sign in",
    "register_profile.title": "Create your account",
    "register_profile.action.submit": "Create account",
    "register_profile.action.login": "Already have an account? Sign in",
    "complete.title": "You're signed in",
  };
  if (authMethods.includes("password")) {
    base["credential.field.password"] = "Password";
    base["credential.action.forgot"] = "Forgot password?";
  }
  for (const field of fields) {
    const key = `register_profile.field.${field}`;
    if (!(key in base)) {
      base[key] = fieldLabelFor(field);
    }
  }
  return base;
}

function fieldLabelFor(field: string): string {
  switch (field) {
    case "email":
      return "Email address";
    case "given_name":
      return "First name";
    case "family_name":
      return "Last name";
    case "phone":
      return "Phone number";
    case "date_of_birth":
    case "birthdate":
      return "Date of birth";
    default:
      return "";
  }
}

function mergePlans(...plans: ScaffoldPlan[]): ScaffoldPlan {
  return {
    ops: plans.flatMap((plan) => plan.ops),
    summary: plans.flatMap((plan) => plan.summary),
  };
}
