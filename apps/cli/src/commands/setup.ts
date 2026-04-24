import { getAdapter } from "../adapters/registry";
import type { ProjectContext } from "../adapters";
import { detectFramework } from "../detect/framework";
import { detectPackageManager } from "../detect/package-manager";
import { detectDevPort, issuerFromPort } from "../detect/port";
import { readPackageJson } from "../detect/package-json";
import { hasZitadelConfig, hasZitadelSecret } from "../detect/state";
import { detectDeployTarget } from "../deploy";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { sha256 } from "../lib/hash";
import { stableStringify } from "../lib/json";
import { createPlatformClient } from "../platform";
import { DEFAULT_SERVER, MOCK_SENTINEL } from "../platform/resolve-server";
import type { CreateProjectResponse } from "../platform/schemas";
import { scaffold } from "../scaffolder";
import type { ScaffoldPlan } from "../scaffolder/plan";
import { defaultUserSchema } from "../schema/default";
import { validateJsonSchema } from "../schema/validate";
import { runInteractiveSetup } from "../interactive/setup";
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
  let deployTarget = opts.skipDeployPlatform ? undefined : await detectDeployTarget(opts.cwd, opts.platform);
  const pkg = await readPackageJson(opts.cwd);
  let detectedPort = await detectDevPort(opts.cwd);
  let effectiveServer = opts.source;

  let userFields = splitCsv(opts.userFields);
  let authMethods = splitCsv(opts.authMethods);

  if (!opts.nonInteractive && !opts.dryRun) {
    const answers = await runInteractiveSetup({
      detectedFramework: framework.id,
      detectedDeployPlatform: (deployTarget?.id ?? "none") as "vercel" | "netlify" | "cloudflare" | "none",
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
    throw new ZitadelError("E_VALIDATION", "Generated user schema is invalid", { details: schemaValidation.errors });
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

  const config = projectConfig(project, issuer, framework.id, effectiveServer);
  const flows = flowFiles(userFields);
  const adapter = getAdapter(framework.id);
  const ctx: ProjectContext = {
    cwd: opts.cwd,
    packageManager,
    framework,
    config: {
      project_id: project.project_id,
      issuer,
      preview_origins: project.preview_origins,
      userSchemaPath: ".zitadel/schemas/user.json",
    },
    isInitialSetup: true,
  };
  const plan = mergePlans(
    basePlan({ project, config, userSchema, flows, packageManager, framework: framework.id, issuer, devPort }),
    await adapter.planSetup(ctx),
  );
  const result = await scaffold(plan, opts);
  const warnings: string[] = [];

  const setupOpts = { ...opts, source: effectiveServer };
  const apply = opts.noApply || opts.dryRun ? undefined : await runApply(io, { ...setupOpts, json: true, silent: true });
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
      next_actions: ["Run `zitadel doctor` to verify setup.", "Run `zitadel claim` before production."],
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
  flows: Record<string, unknown>;
  packageManager: string;
  framework: string;
  issuer: string;
  devPort: number;
}): ScaffoldPlan {
  return {
    ops: [
      { kind: "mkdir", path: ".zitadel", mode: 0o700 },
      { kind: "mkdir", path: ".zitadel/flows" },
      { kind: "mkdir", path: ".zitadel/schemas" },
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
      { kind: "write", path: ".zitadel/schemas/user.json", contents: `${stableStringify(input.userSchema)}\n` },
      { kind: "write", path: ".zitadel/flows/login.json", contents: `${stableStringify(input.flows.login)}\n` },
      { kind: "write", path: ".zitadel/flows/register.json", contents: `${stableStringify(input.flows.register)}\n` },
      {
        kind: "merge-env",
        path: ".env.example",
        entries: {
          ZITADEL_PROJECT_ID: "",
          ZITADEL_ENVIRONMENT: "",
          ZITADEL_PROJECT_SECRET: "",
          ZITADEL_ISSUER: "",
          ZITADEL_PREVIEW_SECRET: "",
        },
      },
      {
        kind: "merge-env",
        path: ".env.local",
        entries: {
          ZITADEL_PROJECT_ID: input.project.project_id,
          ZITADEL_ENVIRONMENT: "development",
          ZITADEL_PROJECT_SECRET: input.project.project_secret,
          ZITADEL_ISSUER: input.issuer,
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
    summary: [{ title: "Zitadel config", detail: "Created local config, schema, flows, env, and secret files." }],
  };
}

function projectConfig(
  project: CreateProjectResponse,
  issuer: string,
  framework: string,
  source: string,
): Record<string, unknown> {
  const environments: Record<string, unknown> = {
    development: { issuer },
  };
  if (project.preview_origins.length > 0) {
    environments.preview = { issuer_pattern: project.preview_origins.map((origin) => `https://${origin}`) };
  }

  return {
    $schema: "https://schemas.zitadel.com/v2/project.schema.json",
    project: project.project_id,
    server: projectDefaultServer(source),
    framework: { id: framework },
    flows: {
      login: ".zitadel/flows/login.json",
      register: ".zitadel/flows/register.json",
    },
    schemas: {
      user: ".zitadel/schemas/user.json",
    },
    branding: {
      renderer: "default",
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

function flowFiles(fields: string[]): Record<string, unknown> {
  return {
    login: {
      version: 1,
      purpose: "login",
      schema: "user",
      renderer: "default",
      steps: [
        { name: "identifier", type: "identifier", fields: ["email"] },
        { name: "credential", type: "credential", actions: ["passkey", "password"] },
      ],
    },
    register: {
      version: 1,
      purpose: "register",
      schema: "user",
      renderer: "default",
      steps: [{ name: "profile", type: "form", fields }],
    },
  };
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
