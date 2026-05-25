import { detectDeployTarget } from "../deploy";
import { detectFramework } from "../detect/framework";
import { detectEmptyProject } from "../lib/orca/detect/empty-project";
import { detectPackageManager } from "../detect/package-manager";
import { detectDevPort, issuerFromPort } from "../detect/port";
import { hasZitadelConfig, hasZitadelSecret } from "../detect/state";
import { pickFramework, runInteractiveSetup } from "../interactive/setup";
import type { CliIO, GlobalOptions } from "../io/output";
import { ok, skipped } from "../io/output";
import { ZitadelError } from "../lib/errors";
import { Orca } from "../lib/orca";
import { patchers } from "../lib/orca/patchers";
import { scaffolders } from "../lib/orca/scaffolders";
import { createPlatformClient } from "../platform";
import type { CreateProjectResponse } from "../platform/schemas";
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

  const orca = new Orca(scaffolders, patchers);

  // When no framework is detected, check whether the directory is empty. If it
  // is, scaffold a fresh project first, then re-detect the framework.
  let framework = await detectFramework(opts.cwd, opts.framework).catch(async (err: unknown) => {
    if (
      !(err instanceof ZitadelError) ||
      err.code !== "E_FRAMEWORK_NOT_DETECTED" ||
      !(await detectEmptyProject(opts.cwd))
    ) {
      throw err;
    }

    const frameworkId =
      opts.framework ??
      (opts.nonInteractive
        ? (() => {
            throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", "Empty directory — pass --framework", {
              hint: "Example: --framework nuxt",
            });
          })()
        : await pickFramework(orca.availableFrameworks()));

    await orca.scaffold(opts.cwd, frameworkId, { packageManager: "pnpm" });
    return detectFramework(opts.cwd, frameworkId);
  });

  const packageManager = await detectPackageManager(opts.cwd);
  let deployTarget = opts.skipDeployPlatform
    ? undefined
    : await detectDeployTarget(opts.cwd, opts.platform);
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
        previewOrigins: previewOrigins,
      });

  const result = await orca.patch({
    cwd: opts.cwd,
    packageManager,
    framework,
    rendererId: opts.renderer ?? "react",
    project,
    issuer,
    userFields: userFields ?? [],
    authMethods: authMethods ?? [],
    userSchema,
    server: effectiveServer,
    devPort,
    dryRun: opts.dryRun ?? false,
    force: opts.force ?? false,
  });
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

function splitCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
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
