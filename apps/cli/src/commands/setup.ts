import { Flags } from "@oclif/core";
import { cancel, confirm, intro, isCancel, outro, select, text } from "@clack/prompts";

import { BaseCommand, type CommandResult, type GlobalOptions, type JsonEnvelope } from "../lib/oclif";
import { ZitadelError } from "../lib/errors";
import { AUTH_METHODS, isAuthMethod, type AuthMethod } from "../lib/flows";
import { createOrca, issuerFromPort, type FrameworkFacts, type Orca } from "../lib/orca";
import type { PatchContext } from "../lib/orca/patchers/types";
import { RENDERER_IDS } from "../lib/orca/patchers/rule/next/renderers/registry";
import { buildUserSchema, validateJsonSchema } from "../lib/user-schema";
import { createPlatformClient } from "../lib/api";
import type { CreateProjectResponse } from "../lib/api/client";
import { DEFAULT_SERVER } from "../lib/api/resolve-server";
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

/**
 * The user's choices collected by the interactive wizard. These map directly
 * onto the flags `setup` would otherwise receive non-interactively, so the same
 * downstream planning code runs whether answers came from prompts or flags.
 */
type InteractiveSetupAnswers = {
  authMethod: AuthMethod;
  serverChoice: string;
  devPort: number;
};

/**
 * Auto-detected project facts seeded into the wizard as prompt defaults, so the
 * common case is one keystroke (accept the detection) while still letting the
 * user override the dev port or current server.
 */
type InteractiveSetupInput = {
  detectedFramework: string;
  detectedDevPort: number;
  currentServer: string;
};

const AUTH_METHOD_CHOICES: ReadonlyArray<{ value: AuthMethod; label: string; hint?: string }> = [
  { value: "passkey", label: "passkey", hint: "recommended" },
  { value: "password", label: "password" },
];

/**
 * Drives the interactive setup wizard and returns the collected answers.
 * Prompts are seeded from `input` so detected values are the defaults; any
 * cancellation is converted into a thrown {@link ZitadelError} rather than a
 * partial result. Only invoked in interactive (TTY) mode.
 */
async function runInteractiveSetup(input: InteractiveSetupInput): Promise<InteractiveSetupAnswers> {
  intro("Zitadel setup");

  const frameworkAck = await confirm({
    message: `Detected ${input.detectedFramework}. Proceed?`,
    initialValue: true,
  });
  bail(frameworkAck);
  if (frameworkAck === false) {
    throw new ZitadelError("E_UNSUPPORTED_PROJECT_SHAPE", "Setup cancelled — framework declined", {
      hint: "Re-run with --framework next when ready.",
    });
  }

  const authMethod = await select<AuthMethod>({
    message: "Auth method",
    options: AUTH_METHOD_CHOICES.map(({ value, label, hint }) => ({ value, label, hint })),
    initialValue: "passkey",
  });
  bail(authMethod);

  const serverChoice = await select({
    message: "Which server should zitadel.json point to?",
    options: [
      {
        value: DEFAULT_SERVER,
        label: "Zitadel Cloud (api.zitadel.cloud)",
        hint: "recommended for real projects",
      },
      { value: "__custom__", label: "Custom URL (self-hosted)" },
    ],
    initialValue: input.currentServer ?? DEFAULT_SERVER,
  });
  bail(serverChoice);

  let resolvedServer = serverChoice as string;
  if (serverChoice === "__custom__") {
    const custom = await text({
      message: "Server URL",
      placeholder: "https://zitadel.internal",
      validate: (value) => {
        try {
          new URL(value ?? "");
          return;
        } catch {
          return "Must be a valid URL";
        }
      },
    });
    bail(custom);
    resolvedServer = custom as string;
  }

  const devPortRaw = await text({
    message: "Dev server port",
    placeholder: String(input.detectedDevPort),
    initialValue: String(input.detectedDevPort),
    validate: (value) => {
      const num = Number.parseInt(value ?? "", 10);
      return Number.isFinite(num) && num > 0 && num < 65536 ? undefined : "Must be a port number";
    },
  });
  bail(devPortRaw);
  const devPort = Number.parseInt(String(devPortRaw), 10);

  outro("Ready to scaffold.");

  return { authMethod: authMethod as AuthMethod, serverChoice: resolvedServer, devPort };
}

/**
 * Prompts for a framework to scaffold when the directory is empty and nothing
 * could be auto-detected. Choices come from `Orca.availableFrameworks`.
 */
async function pickFramework(
  choices: ReadonlyArray<{ id: string; displayName: string }>,
): Promise<string> {
  intro("Zitadel setup — new project");
  const picked = await select({
    message: "Choose a framework to scaffold",
    options: choices.map((choice) => ({ value: choice.id, label: choice.displayName })),
  });
  bail(picked);
  return picked as string;
}

/** Converts a clack cancellation (Ctrl-C) into a thrown {@link ZitadelError}. */
function bail<T>(value: T | symbol): asserts value is T {
  if (isCancel(value)) {
    cancel("Setup cancelled.");
    throw new ZitadelError("E_VALIDATION", "Setup cancelled by user");
  }
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
