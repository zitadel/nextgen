import { Flags } from "@oclif/core";
import { intro, outro, spinner } from "@clack/prompts";

import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { AUTH_METHODS, isAuthMethod, type AuthMethod } from "../../lib/flows";
import { createOrca, issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import { RENDERER_IDS } from "../../lib/orca/patchers/rule/next/renderers/registry";
import { CreateSchemaBody } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod";

import { buildUserSchema } from "../../lib/user-schema";
import { createPlatformClient } from "../../lib/api";
import type { CreateProjectResponse } from "../../lib/api/client";
import { makeSyncers, runSyncLoop } from "../../lib/sync";
import { hasZitadelConfig, hasZitadelSecret, readZitadelSecret } from "../../lib/project";
import { PickFrameworkPrompt, SETUP_PROMPTS, type SetupAnswers } from "./prompts";

/** The user-schema fields scaffolded for every project. */
const DEFAULT_USER_FIELDS = ["email", "given_name", "family_name"] as const;

/**
 * The frameworks `--framework` accepts, derived from Orca's registry so the
 * flag can't drift from what the CLI can actually scaffold. `createOrca` is
 * pure (it only builds the in-memory registries), so this is safe at module
 * load.
 */
const FRAMEWORK_OPTIONS = createOrca()
  .availableFrameworks()
  .map((framework) => framework.id);

/** `zitadel setup` — create a project and scaffold local auth.
 *
 * Detects (or, for an empty directory, scaffolds then re-detects) the
 * framework, runs the wizard prompts to fill in any answers not pre-supplied
 * by flags, creates the remote project, patches the local files via
 * `Orca`'s framework patcher, and optionally applies the config.
 *
 * Every interactive question lives in {@link SETUP_PROMPTS} (the main wizard
 * — each entry is a small class) and {@link PickFrameworkPrompt} (the
 * empty-directory framework choice, before the main wizard).
 */
export default class Setup extends BaseCommand {
  static override description = "Create a Zitadel project and scaffold local auth.";
  static override examples = ["<%= config.bin %> setup --framework next --auth-method passkey"];
  static override flags = {
    framework: Flags.string({ description: "Framework to target.", options: FRAMEWORK_OPTIONS }),
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
    const { cwd, env, nonInteractive, dryRun, force } = this.meta;

    if (await hasZitadelConfig(cwd)) {
      return this.emit({ status: "skipped", reason: "already-initialized" });
    }
    if (await hasZitadelSecret(cwd)) {
      throw new ZitadelError("E_CONFLICT", ".zitadel/secret exists without zitadel.json", {
        hint: "Move the secret aside or restore zitadel.json before running setup.",
      });
    }

    const orca = createOrca();

    let framework: FrameworkFacts;
    try {
      framework = await orca.detect(cwd, flags.framework);
    } catch (error) {
      if (
        error instanceof ZitadelError &&
        error.code === "E_FRAMEWORK_NOT_DETECTED" &&
        (await orca.isEmpty(cwd))
      ) {
        framework = await orca.scaffold(cwd, await resolveScaffoldFramework(flags.framework, nonInteractive, orca));
      } else {
        throw error;
      }
    }

    let answers: SetupAnswers = {
      authMethod: isAuthMethod(flags["auth-method"]) ? flags["auth-method"] : undefined,
      server: this.meta.source,
      devPort: framework.devPort,
    };

    if (!nonInteractive && !dryRun) {
      intro("Zitadel setup");
      for (const prompt of SETUP_PROMPTS) {
        answers = await prompt.ask(answers, { framework });
      }
      outro("Ready to scaffold.");
    }

    const issuer = issuerFromPort(answers.devPort);
    const userFields = [...DEFAULT_USER_FIELDS];
    const resolvedMethod: AuthMethod = answers.authMethod ?? "passkey";
    const userSchema = buildUserSchema(resolvedMethod, userFields);
    const schemaValidation = CreateSchemaBody.safeParse(userSchema);
    if (!schemaValidation.success) {
      throw new ZitadelError("E_VALIDATION", "Generated user schema is invalid", {
        details: { issues: schemaValidation.error.issues },
      });
    }

    const sp = interactiveSpinner(!nonInteractive && !dryRun);

    sp?.start("Creating project on the platform");
    const project = dryRun
      ? dryRunProject()
      : await createPlatformClient(answers.server).createProject({ previewOrigins: [] });

    const ctx: PatchContext = {
      framework,
      rendererId: flags.renderer ?? "react",
      project,
      issuer,
      userFields,
      authMethod: resolvedMethod,
      userSchema,
      server: answers.server,
    };
    sp?.message("Writing project files");
    const result = await orca.patcherFor(framework.id).patch(ctx, { cwd, dryRun, force });

    let apply: { synced: boolean } | undefined;
    if (!flags["no-apply"] && !dryRun) {
      sp?.message("Syncing config to the platform");
      const secret = await readZitadelSecret(cwd);
      const client = createPlatformClient(answers.server, secret.project_secret);
      await runSyncLoop(cwd, client, makeSyncers({ projectId: secret.project_id, env }));
      apply = { synced: true };
    }
    sp?.stop("Zitadel is ready.");

    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel is ready.",
        project: { project_id: project.id, issuer },
        framework: framework.id,
        server: answers.server,
        files_written: result.filesWritten.map((file) => relativeDisplay(cwd, file)),
        files_skipped: result.filesSkipped.map((file) => relativeDisplay(cwd, file)),
        apply,
        next_actions: ["Run `zitadel doctor` to verify setup."],
        next_commands: ["zitadel doctor"],
      },
    });
  }
}

/**
 * Resolves which framework to scaffold into an empty directory: the explicit
 * `--framework`, else PickFrameworkPrompt, else a hard error in non-interactive
 * mode (an agent must pass `--framework`).
 */
async function resolveScaffoldFramework(
  framework: string | undefined,
  nonInteractive: boolean,
  orca: Orca,
): Promise<string> {
  if (framework) {
    return framework;
  }
  if (nonInteractive) {
    throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", "Empty directory — pass --framework", {
      hint: "Example: --framework next",
    });
  }
  return new PickFrameworkPrompt().ask(orca.availableFrameworks());
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
 * Returns a `clack` spinner only when the caller is running interactively
 * (`--non-interactive`, `--json`, `--dry-run`, and no-TTY all suppress it).
 * Setup's post-wizard execution uses one to thread `.message()` across the
 * create-project / patch / apply phases without polluting machine-readable
 * output with spinner frames.
 */
function interactiveSpinner(visible: boolean): ReturnType<typeof spinner> | null {
  return visible ? spinner() : null;
}
