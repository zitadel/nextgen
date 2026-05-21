import type { ProjectContext } from "../adapters";
import { getAdapter } from "../adapters/registry";
import { detectDeployTarget } from "../deploy";
import { detectFramework } from "../detect/framework";
import { readPackageJson } from "../detect/package-json";
import { detectPackageManager } from "../detect/package-manager";
import { detectDevPort, issuerFromPort } from "../detect/port";
import { hasZitadelConfig, hasZitadelSecret } from "../detect/state";
import { runInteractiveSetup } from "../interactive/setup";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { sha256 } from "../lib/hash";
import { stableStringify } from "../lib/json";
import { createPlatformClient } from "../platform";
import { DEFAULT_SERVER, MOCK_SENTINEL } from "../platform/resolve-server";
import type { CreateProjectResponse } from "../platform/schemas";
import { getRenderer } from "../renderers/registry";
import { scaffold } from "../scaffolder";
import type { ScaffoldPlan } from "../scaffolder/plan";
import { defaultUserSchema } from "../schema/default";
import { validateJsonSchema } from "../schema/validate";
import { runApply } from "./apply";
import { runDeployConnect } from "./deploy";

export type SetupOptions = GlobalOptions & {
  framework?: string;
  userFields?: string;
  authMethods?: string;
  skipDeployPlatform?: boolean;
  manualDeploy?: boolean;
  noApply?: boolean;
  platform?: string;
  renderer?: string;
};

export async function runSetup(io: CliIO, opts: SetupOptions): Promise<void> {
  if (await hasZitadelConfig(opts.cwd)) {
    skipped(io, "already-initialized", opts);
    return;
  }

  if (await hasZitadelSecret(opts.cwd)) {
    throw new ZitadelError("E_CONFLICT", ".zitadel/secret exists without zitadel.json", {
      hint: "Move the secret aside or restore zitadel.json before running setup.",
    });
  }

  const framework = await detectFramework(opts.cwd, opts.framework);
  const packageManager = await detectPackageManager(opts.cwd);
  let deployTarget = opts.skipDeployPlatform
    ? undefined
    : await detectDeployTarget(opts.cwd, opts.platform);
  const pkg = await readPackageJson(opts.cwd);
  let detectedPort = await detectDevPort(opts.cwd);
  let effectiveServer = opts.source;

  let userFields = splitCsv(opts.userFields);
  let authMethods = splitCsv(opts.authMethods);

  if (!opts.nonInteractive && !opts.dryRun) {
    const answers = await runInteractiveSetup({
      detectedFramework: framework.id,
      detectedDeployPlatform: (deployTarget?.id ?? "none") as
        | "vercel"
        | "netlify"
        | "cloudflare"
        | "none",
      detectedDevPort: detectedPort,
      currentServer: opts.source,
    });
    userFields = userFields ?? answers.userFields;
    authMethods = authMethods ?? answers.authMethods;
    effectiveServer = answers.serverChoice;
    detectedPort = answers.devPort;
    if (answers.deployPlatform !== (deployTarget?.id ?? "none")) {
      deployTarget = await detectDeployTarget(opts.cwd, answers.deployPlatform);
    }
  }

  const previewOrigins = deployTarget?.previewOrigins ?? [];
  const devPort = detectedPort;
  const issuer = issuerFromPort(devPort);
  userFields = userFields ?? ["email", "given_name", "family_name"];
  authMethods = authMethods ?? ["passkey", "password"];
  const userSchema = defaultUserSchema({ fields: userFields, authMethods });
  const schemaValidation = validateJsonSchema(userSchema);
  if (!schemaValidation.valid) {
    throw new ZitadelError("E_VALIDATION", "Generated user schema is invalid", {
      details: schemaValidation.errors,
    });
  }

  const project = opts.dryRun
    ? dryRunProject(previewOrigins)
    : await createPlatformClient(effectiveServer).createProject({
        preview_origins: previewOrigins,
        slug_preference: pkg.name,
        client_metadata: {
          framework: framework.id,
          package_manager: packageManager,
          cli: "zitadel",
        },
      });

  const rendererId = opts.renderer ?? "react";
  const renderer = getRenderer(rendererId);
  const config = projectConfig(project, issuer, framework.id, effectiveServer, rendererId);
  const flow = defaultFlowDefinition(userFields, authMethods);
  const locale = defaultLocaleSeed(userFields, authMethods);
  const adapter = getAdapter(framework.id);
  const ctx: ProjectContext = {
    cwd: opts.cwd,
    packageManager,
    framework,
    renderer,
    config: {
      project_id: project.project_id,
      issuer,
      preview_origins: project.preview_origins,
      userSchemaPath: ".zitadel/schemas/user.json",
    },
    isInitialSetup: true,
  };
  const plan = mergePlans(
    basePlan({
      project,
      config,
      userSchema,
      flow,
      locale,
      packageManager,
      framework: framework.id,
      issuer,
      devPort,
      server: effectiveServer,
    }),
    await adapter.planSetup(ctx),
  );
  const result = await scaffold(plan, opts);
  const warnings: string[] = [];

  const setupOpts = { ...opts, source: effectiveServer };
  const apply =
    opts.noApply || opts.dryRun
      ? undefined
      : await runApply(io, { ...setupOpts, json: true, silent: true });
  const deploy =
    !deployTarget || deployTarget.id === "none" || opts.skipDeployPlatform || opts.dryRun
      ? undefined
      : await runDeployConnect(io, {
          ...setupOpts,
          json: true,
          silent: true,
          environment: "preview",
          platform: deployTarget.id,
          manual: opts.manualDeploy,
        });

  if (deploy && !deploy.configured && deploy.manual_steps.length > 0) {
    warnings.push(...deploy.manual_steps);
  }

  ok(
    io,
    {
      title: "Zitadel is ready in pre-claim mode.",
      project: {
        project_id: project.project_id,
        lifecycle: "pre-claim",
        issuer,
        scratch_dashboard_url: project.scratch_dashboard_url,
      },
      framework: framework.id,
      package_manager: packageManager,
      server: effectiveServer,
      files_written: result.filesWritten.map((file) => relativeDisplay(opts.cwd, file)),
      files_skipped: result.filesSkipped.map((file) => relativeDisplay(opts.cwd, file)),
      apply,
      deploy,
      next_actions: [
        "Run `zitadel doctor` to verify setup.",
        "Run `zitadel claim` before production.",
      ],
      next_commands: ["zitadel doctor", "zitadel claim"],
    },
    setupOpts,
    warnings,
  );
}

function basePlan(input: {
  project: CreateProjectResponse;
  config: Record<string, unknown>;
  userSchema: unknown;
  flow: Record<string, unknown>;
  locale: Record<string, string>;
  packageManager: string;
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
          project_id: input.project.project_id,
          project_secret: input.project.project_secret,
          preview_secret: input.project.preview_secret,
          preview_origins: input.project.preview_origins,
          created_at: input.project.created_at,
          schema_version: input.project.schema_version,
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
          ZITADEL_PROJECT_ID: input.project.project_id,
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
          package_manager: input.packageManager,
          setup_version: 1,
          config_hash: sha256(input.config),
          dev_port: input.devPort,
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

function projectConfig(
  project: CreateProjectResponse,
  issuer: string,
  framework: string,
  source: string,
  renderer: string,
): Record<string, unknown> {
  const environments: Record<string, unknown> = {
    development: { issuer },
  };
  if (project.preview_origins.length > 0) {
    environments.preview = {
      issuer_pattern: project.preview_origins.map((origin) => `https://${origin}`),
    };
  }

  return {
    $schema: "https://schemas.zitadel.com/v2/project.schema.json",
    project: project.project_id,
    server: projectDefaultServer(source),
    framework: { id: framework },
    branding: {
      renderer,
      attribution: "visible",
    },
    environments,
  };
}

function projectDefaultServer(source: string): string {
  if (source === MOCK_SENTINEL) return MOCK_SENTINEL;
  try {
    return new URL(source).origin;
  } catch {
    return DEFAULT_SERVER;
  }
}

function defaultFlowDefinition(fields: string[], authMethods: string[]): Record<string, unknown> {
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
    version: 1,
    kind: "flow-definition",
    slug: "default",
    name: "Default login & registration",
    purposes: ["login", "register"],
    template_name: "default",
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
  if (field === "email") return "email";
  if (field === "phone") return "tel";
  if (field === "password") return "password";
  if (field === "date_of_birth" || field === "birthdate") return "date";
  return "text";
}

export function defaultLocaleSeed(fields: string[], authMethods: string[]): Record<string, string> {
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

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function dryRunProject(previewOrigins: string[]): CreateProjectResponse {
  return {
    project_id: "dry-run-0000",
    project_secret: "sk_proj_dry_run_full",
    preview_secret: "sk_proj_dry_run_preview",
    preview_origins: previewOrigins,
    created_at: "2026-04-21T14:03:11.000Z",
    scratch_dashboard_url: "https://zitadel.dev/scratch/dry-run-0000",
    schema_version: 2,
  };
}

function relativeDisplay(cwd: string, path: string): string {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}
