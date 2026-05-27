import type { ProjectContext } from "../adapters";
import { getAdapter } from "../adapters/registry";
import { detectDeployTarget } from "../deploy";
import { detectFramework } from "../detect/framework";
import { detectPackageManager } from "../detect/package-manager";
import { detectDevPort, issuerFromPort } from "../detect/port";
import { hasZitadelConfig, hasZitadelSecret } from "../detect/state";
import { runInteractiveSetup } from "../interactive/setup";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { AUTH_METHODS, type AuthMethod, buildFlowAndLocale } from "../lib/flows";
import { stableStringify } from "../lib/json";
import { createPlatformClient } from "../platform";
import { DEFAULT_SERVER } from "../platform/resolve-server";
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
  authMethod?: string;
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
  let detectedPort = await detectDevPort(opts.cwd);
  let effectiveServer = opts.source;

  let userFields = splitCsv(opts.userFields);
  let authMethod: AuthMethod | undefined = parseAuthMethod(opts.authMethod);

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
    authMethod = authMethod ?? answers.authMethod;
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
  const resolvedMethod: AuthMethod = authMethod ?? "passkey";
  const userSchema = defaultUserSchema({ fields: userFields, authMethods: resolvedMethod });
  const schemaValidation = validateJsonSchema(userSchema);
  if (!schemaValidation.valid) {
    throw new ZitadelError("E_VALIDATION", "Generated user schema is invalid", {
      details: schemaValidation.errors,
    });
  }

  const project = opts.dryRun
    ? dryRunProject(previewOrigins)
    : await createPlatformClient(effectiveServer).createProject({
        previewOrigins: previewOrigins,
      });

  const rendererId = opts.renderer ?? "react";
  const renderer = getRenderer(rendererId);
  const config = projectConfig(project, issuer, framework.id, effectiveServer, rendererId);
  const { flow, locale } = buildFlowAndLocale(resolvedMethod, { fields: userFields });
  const adapter = getAdapter(framework.id);
  const ctx: ProjectContext = {
    cwd: opts.cwd,
    packageManager,
    framework,
    renderer,
    config: {
      project_id: project.id,
      issuer,
      preview_origins: project.previewOrigins,
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
  let apply: { synced: boolean } | undefined;
  if (!opts.noApply && !opts.dryRun) {
    await runApply(io, { ...setupOpts, json: true, silent: true });
    apply = { synced: true };
  }
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
        project_id: project.id,
        lifecycle: "pre-claim",
        issuer,
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
  flow: unknown;
  locale: Readonly<Record<string, string>>;
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
  if (project.previewOrigins.length > 0) {
    environments.preview = {
      issuer_pattern: project.previewOrigins.map((origin) => `https://${origin}`),
    };
  }

  return {
    $schema: "https://schemas.zitadel.com/v2/project.schema.json",
    project: project.id,
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
  try {
    return new URL(source).origin;
  } catch {
    return DEFAULT_SERVER;
  }
}

function parseAuthMethod(value: string | undefined): AuthMethod | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!(AUTH_METHODS as ReadonlyArray<string>).includes(trimmed)) {
    throw new ZitadelError(
      "E_VALIDATION",
      `Unknown auth method "${trimmed}". Allowed: ${AUTH_METHODS.join(", ")}.`,
    );
  }
  return trimmed as AuthMethod;
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
    id: "dry-run-0000",
    projectSecret: "sk_proj_dry_run_full",
    previewSecret: "sk_proj_dry_run_preview",
    previewOrigins,
    createdAt: "2026-04-21T14:03:11.000Z",
  };
}

function relativeDisplay(cwd: string, path: string): string {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}
