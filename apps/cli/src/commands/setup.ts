import { Flags } from "@oclif/core";

import { pickFramework, runInteractiveSetup } from "../interactive/setup";
import { BaseCommand, type CommandResult, type GlobalOptions, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import { AUTH_METHODS, isAuthMethod, type AuthMethod } from "../lib/flows";
import { createOrca, issuerFromPort, type FrameworkFacts, type Orca } from "../lib/orca";
import type { PatchContext } from "../lib/orca/patchers/types";
import { RENDERER_IDS } from "../lib/orca/patchers/rule/next/renderers/registry";
import { buildUserSchema, validateJsonSchema } from "../lib/user-schema";
import { createPlatformClient } from "../lib/api";
import type { CreateProjectResponse } from "../lib/api/client";
import { hasZitadelConfig, hasZitadelSecret } from "../lib/project";
import { runApply } from "./apply";

/**
 * Inputs for {@link runSetup}, extending the global options with the
 * setup-specific flags collected by the arg parser. All fields are optional
 * because setup fills gaps interactively (when allowed) or from detection and
 * sensible defaults, so a bare invocation with only the globals is valid.
 */
export type SetupOptions = GlobalOptions & {
  framework?: string;
  authMethod?: string;
  noApply?: boolean;
  renderer?: string;
};

/** The user-schema fields scaffolded for every project. */
const DEFAULT_USER_FIELDS = ["email", "given_name", "family_name"] as const;

/**
 * Scaffolds a new Zitadel project into the target directory: detects (or, for an
 * empty directory, scaffolds then re-detects) the framework, resolves auth/schema
 * choices (prompting interactively unless suppressed), creates the remote project,
 * then patches it via {@link Orca}'s framework patcher and optionally applies the
 * config. Idempotent at the front: it skips when already initialized and refuses
 * to proceed on an orphaned secret.
 */
export async function runSetup(opts: SetupOptions): Promise<CommandResult> {
  if (await hasZitadelConfig(opts.cwd)) {
    return { status: "skipped", reason: "already-initialized" };
  }

  if (await hasZitadelSecret(opts.cwd)) {
    throw new ZitadelError("E_CONFLICT", ".zitadel/secret exists without zitadel.json", {
      hint: "Move the secret aside or restore zitadel.json before running setup.",
    });
  }

  const orca = createOrca();

  // Detect the framework; when none is found and the directory is empty,
  // scaffold a project from scratch (prompting or via --framework) and let
  // Orca re-detect it. Orca.scaffold throws if the directory is not empty.
  let framework: FrameworkFacts;
  try {
    framework = await orca.detect(opts.cwd, opts.framework);
  } catch (error) {
    if (
      error instanceof ZitadelError &&
      error.code === "E_FRAMEWORK_NOT_DETECTED" &&
      (await orca.isEmpty(opts.cwd))
    ) {
      framework = await orca.scaffold(opts.cwd, await resolveScaffoldFramework(opts, orca));
    } else {
      throw error;
    }
  }

  let detectedPort = framework.devPort;
  let effectiveServer = opts.source;

  // The `--auth-method` flag is validated against AUTH_METHODS by oclif; guard
  // anyway so an out-of-band caller can't smuggle an invalid value through.
  let authMethod: AuthMethod | undefined = isAuthMethod(opts.authMethod)
    ? opts.authMethod
    : undefined;

  if (!opts.nonInteractive && !opts.dryRun) {
    const answers = await runInteractiveSetup({
      detectedFramework: framework.id,
      detectedDevPort: detectedPort,
      currentServer: opts.source,
    });
    authMethod = authMethod ?? answers.authMethod;
    effectiveServer = answers.serverChoice;
    detectedPort = answers.devPort;
  }

  const issuer = issuerFromPort(detectedPort);
  const resolvedFields = [...DEFAULT_USER_FIELDS];
  const resolvedMethod: AuthMethod = authMethod ?? "passkey";
  const userSchema = buildUserSchema(resolvedMethod, resolvedFields);
  const schemaValidation = validateJsonSchema(userSchema);
  if (!schemaValidation.valid) {
    throw new ZitadelError("E_VALIDATION", "Generated user schema is invalid", {
      details: schemaValidation.errors,
    });
  }

  const project = opts.dryRun
    ? dryRunProject()
    : await createPlatformClient(effectiveServer).createProject({ previewOrigins: [] });

  const ctx: PatchContext = {
    framework,
    rendererId: opts.renderer ?? "react",
    project,
    issuer,
    userFields: resolvedFields,
    authMethod: resolvedMethod,
    userSchema,
    server: effectiveServer,
  };
  const result = await orca
    .patcherFor(framework.id)
    .patch(ctx, { cwd: opts.cwd, dryRun: opts.dryRun, force: opts.force });

  const setupOpts = { ...opts, source: effectiveServer };
  let apply: { synced: boolean } | undefined;
  if (!opts.noApply && !opts.dryRun) {
    await runApply(setupOpts);
    apply = { synced: true };
  }

  return {
    status: "ok",
    data: {
      title: "Zitadel is ready.",
      project: {
        project_id: project.id,
        issuer,
      },
      framework: framework.id,
      server: effectiveServer,
      files_written: result.filesWritten.map((file) => relativeDisplay(opts.cwd, file)),
      files_skipped: result.filesSkipped.map((file) => relativeDisplay(opts.cwd, file)),
      apply,
      next_actions: ["Run `zitadel doctor` to verify setup."],
      next_commands: ["zitadel doctor"],
    },
  };
}

/**
 * Resolves which framework to scaffold into an empty directory: the explicit
 * `--framework`, else an interactive pick, else a hard error in non-interactive
 * mode (an agent must pass `--framework`).
 */
async function resolveScaffoldFramework(opts: SetupOptions, orca: Orca): Promise<string> {
  if (opts.framework) {
    return opts.framework;
  }
  if (opts.nonInteractive) {
    throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", "Empty directory — pass --framework", {
      hint: "Example: --framework next",
    });
  }
  return pickFramework(orca.availableFrameworks());
}

/** A deterministic stand-in project for `--dry-run`, so no remote call is made. */
function dryRunProject(): CreateProjectResponse {
  return {
    id: "dry-run-0000",
    projectSecret: "sk_proj_dry_run_full",
    previewSecret: "sk_proj_dry_run_preview",
    previewOrigins: [],
    createdAt: "2026-04-21T14:03:11.000Z",
  };
}

/** Renders an absolute path relative to `cwd` for human-readable output. */
function relativeDisplay(cwd: string, path: string): string {
  return path.startsWith(cwd) ? path.slice(cwd.length + 1) : path;
}

/** `zitadel setup` — create a project and scaffold local auth. */
export default class Setup extends BaseCommand {
  static override description = "Create a Zitadel project and scaffold local auth.";
  static override examples = ["<%= config.bin %> setup --framework next --auth-method passkey"];
  static override flags = {
    framework: Flags.string({ description: "Framework to target.", options: ["next"] }),
    "auth-method": Flags.string({
      description: "Auth method (default: passkey).",
      options: [...AUTH_METHODS],
    }),
    renderer: Flags.string({ description: "Renderer (default: react).", options: [...RENDERER_IDS] }),
    "no-apply": Flags.boolean({ description: "Skip the automatic apply at the end of setup." }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Setup);
    await this.toMeta(flags);
    return this.emit(
      await runSetup({
        ...this.meta,
        framework: flags.framework,
        authMethod: flags["auth-method"],
        renderer: flags.renderer,
        noApply: flags["no-apply"],
      }),
    );
  }
}
