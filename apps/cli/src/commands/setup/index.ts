import { Flags } from "@oclif/core";
import { intro, outro } from "@clack/prompts";
import { consola } from "consola";

import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { createOrca, issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext, PatcherNarration } from "../../lib/orca/patchers/types";
import { RENDERER_IDS } from "../../lib/orca/patchers/rule/next/renderers/registry";
import { CreateSchemaBody } from "@zitadel-nextgen/api/generated/endpoints/zitadelNextGen.zod";
import type { CreateProject201 } from "@zitadel-nextgen/api/generated/model";
import { createZitadelClient } from "@zitadel-nextgen/api/client";

import { buildUserSchema } from "../../lib/user-schema";
import { makeSyncers, runSyncLoop } from "../../lib/sync";
import { hasZitadelConfig, hasZitadelSecret, readZitadelSecret } from "../../lib/project";
import { PickFrameworkPrompt, SETUP_PROMPTS, type SetupAnswers } from "./prompts";
import {
  detectProjectFacts,
  fileNameOf,
  formatFrameworkLine,
  id as styleId,
  path as stylePath,
  renderSummary,
  url as styleUrl,
  type Row,
  type Section,
} from "./summary";

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
  static override examples = ["<%= config.bin %> setup --framework next"];
  static override flags = {
    framework: Flags.string({ description: "Framework to target.", options: FRAMEWORK_OPTIONS }),
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

    consola.start(`Detecting framework in ${shortPath(cwd)}`);
    let framework: FrameworkFacts;
    let scaffoldedFramework = false;
    try {
      framework = await orca.detect(cwd, flags.framework);
      consola.success(`Detected ${framework.id}${framework.devPort ? ` (dev port ${framework.devPort})` : ""}`);
    } catch (error) {
      if (
        error instanceof ZitadelError &&
        error.code === "E_FRAMEWORK_NOT_DETECTED" &&
        (await orca.isEmpty(cwd))
      ) {
        consola.info("Empty directory — scaffolding a fresh project");
        framework = await orca.scaffold(cwd, await resolveScaffoldFramework(flags.framework, nonInteractive, orca));
        scaffoldedFramework = true;
        consola.success(`Scaffolded ${framework.id} skeleton`);
      } else {
        throw error;
      }
    }

    let answers: SetupAnswers = {
      server: this.meta.source,
      devPort: framework.devPort,
    };

    if (!nonInteractive && !dryRun) {
      intro("Zitadel setup");
      const promptCtx = { framework, serverFlag: this.meta.serverFlag };
      for (const prompt of SETUP_PROMPTS) {
        answers = await prompt.ask(answers, promptCtx);
      }
      outro("Configuration captured");
    }

    const issuer = issuerFromPort(answers.devPort);
    const userFields = [...DEFAULT_USER_FIELDS];
    const userSchema = buildUserSchema(userFields);
    const schemaValidation = CreateSchemaBody.safeParse(userSchema);
    if (!schemaValidation.success) {
      throw new ZitadelError("E_VALIDATION", "Generated user schema is invalid", {
        details: { issues: schemaValidation.error.issues },
      });
    }
    consola.info(`User schema: ${userFields.length} fields (${userFields.join(", ")})`);

    // `POST /projects` is unauthenticated; the returned `projectSecret`
    // authorises every subsequent call (we build a second, token-bound
    // client further down for the sync loop).
    consola.start(`Creating project on ${answers.server}${dryRun ? " (dry run)" : ""}`);
    const unauthClient = createZitadelClient({ baseUrl: answers.server });
    const project = dryRun
      ? dryRunProject()
      : await unauthClient.createProject({ previewOrigins: [] });
    consola.success(`Created project ${project.id}`);

    const ctx: PatchContext = {
      framework,
      rendererId: flags.renderer ?? "react",
      project,
      issuer,
      userFields,
      userSchema,
      server: answers.server,
    };
    consola.start(`Patching project files${dryRun ? " (dry run)" : ""}`);
    const patcher = orca.patcherFor(framework.id);
    const result = await patcher.patch(ctx, { cwd, dryRun, force });
    const narration = patcher.narration(ctx);
    const verb = dryRun ? "Would write" : "Wrote";
    for (const file of result.filesWritten) {
      const rel = relativeDisplay(cwd, file);
      if (narration.silent.includes(rel)) continue;
      const sentence = narration.sentences.find((s) => rel === s.path || rel.endsWith(`/${s.path}`));
      consola.info(
        sentence
          ? `${verb} ${sentence.subject} (${stylePath(rel)})`
          : `${verb} ${stylePath(rel)}`,
      );
    }
    for (const file of result.filesSkipped) {
      consola.info(`Left ${relativeDisplay(cwd, file)} unchanged (already matches target)`);
    }
    consola.success(
      `Patched ${result.filesWritten.length} file${result.filesWritten.length === 1 ? "" : "s"}` +
        (result.filesSkipped.length > 0 ? ` (${result.filesSkipped.length} unchanged)` : ""),
    );

    let apply: { synced: boolean } | undefined;
    if (!flags["no-apply"] && !dryRun) {
      consola.start("Syncing schemas and flows to Zitadel");
      const secret = await readZitadelSecret(cwd);
      const client = createZitadelClient({
        baseUrl: answers.server,
        token: secret.project_secret,
      });
      // `runSyncLoop` emits one `consola.info` line per resource action.
      await runSyncLoop(
        cwd,
        makeSyncers({ client, projectId: secret.project_id, env }),
      );
      apply = { synced: true };
      consola.success("Sync complete");
    } else if (flags["no-apply"]) {
      consola.info("Skipping apply (--no-apply); run `zitadel apply` later to sync");
    } else if (dryRun) {
      consola.info("Skipping apply (--dry-run)");
    }

    const writtenRel = result.filesWritten.map((file) => relativeDisplay(cwd, file));
    // The structured report is human-only. Under `--json` we let the
    // envelope returned from `this.emit(...)` be the sole stdout
    // payload (oclif requires single-doc JSON).
    if (!this.jsonEnabled()) {
      const projectFacts = await detectProjectFacts(cwd, framework.id);
      const sections = buildSummary({
        projectFacts,
        writtenRel,
        narration,
        project,
        server: answers.server,
        issuer,
        userFields,
        synced: Boolean(apply?.synced),
        scaffoldedFramework,
      });
      // Frame the report in a consola box so it reads as a distinct
      // status panel separate from the per-step narration above it.
      // `box` accepts ANSI-styled text in the message body, so our
      // pre-coloured rows (path/url/id helpers) survive intact.
      consola.box({
        title: "Zitadel is ready",
        message: [
          renderSummary(sections),
          "",
          `Open your app on ${styleUrl(`${issuer}/login`)} and register your first user.`,
        ].join("\n"),
        style: { padding: 1, borderStyle: "rounded", borderColor: "green" },
      });
    }

    return this.emit({
      status: "ok",
      // Human-facing output was already shown via consola (box + per-step
      // narration). Pass an empty `pretty` so the base command's fallback
      // renderer doesn't duplicate the summary on stdout. The JSON envelope
      // still carries the full structured payload.
      pretty: "",
      data: {
        title: "Zitadel is ready.",
        project: { project_id: project.id, issuer },
        framework: framework.id,
        server: answers.server,
        files_written: result.filesWritten.map((file) => relativeDisplay(cwd, file)),
        files_skipped: result.filesSkipped.map((file) => relativeDisplay(cwd, file)),
        apply,
        next_actions: [`Start your project: npm install && npm run dev (then open ${issuer}/login)`],
        next_commands: ["npm install", "npm run dev"],
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
function dryRunProject(): CreateProject201 {
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
 * Replaces the user's `$HOME` with `~` in a path for compact terminal output.
 * Falls back to the raw path when `HOME` isn't set or doesn't match.
 */
function shortPath(absolute: string): string {
  const home = process.env.HOME;
  if (home && absolute.startsWith(home)) {
    return `~${absolute.slice(home.length)}`;
  }
  return absolute;
}

/** Builds the section list driving {@link renderSummary} for the setup command. */
function buildSummary(opts: {
  projectFacts: Awaited<ReturnType<typeof detectProjectFacts>>;
  writtenRel: string[];
  /** Narration from the patcher — provides the framework-specific INSTALLED rows. */
  narration: PatcherNarration;
  project: CreateProject201;
  server: string;
  issuer: string;
  userFields: string[];
  synced: boolean;
  scaffoldedFramework: boolean;
}): Section[] {
  const { projectFacts, writtenRel, narration, project, server, issuer, userFields, synced, scaffoldedFramework } = opts;

  const detected: Row[] = [
    { label: "Framework", value: formatFrameworkLine(projectFacts) },
  ];
  if (scaffoldedFramework) {
    detected.push({ label: "Scaffold", value: "fresh project (no existing files)" });
  }

  const installedRows: Row[] = [];
  for (const row of narration.installedRows) {
    const hit = writtenRel.find((file) => file === row.path || file.endsWith(`/${row.path}`));
    if (!hit) continue;
    // The "Package" row is the special one: its value is the SDK name
    // (provided by the patcher), and the secondary text points at the
    // manifest filename. Every other row's value is the cyan path.
    if (row.label === "Package") {
      installedRows.push({
        label: row.label,
        value: narration.sdkPackage,
        secondary: stylePath(fileNameOf(hit)),
      });
    } else {
      installedRows.push({
        label: row.label,
        value: stylePath(hit),
        secondary: row.secondary,
      });
    }
  }

  const configuredRows: Row[] = [
    {
      label: "User schema",
      value: `${userFields.length} fields (${userFields.join(", ")})`,
    },
    { label: "Auth method", value: "Password" },
  ];

  const projectRows: Row[] = [
    { label: "Project id", value: styleId(project.id) },
    { label: "Server", value: styleUrl(server) },
    { label: "App will run", value: styleUrl(issuer) },
    { label: "Synced", value: synced ? "yes" : "no" },
  ];

  return [
    { title: "Detected", rows: detected },
    { title: "Installed", rows: installedRows },
    { title: "Configured", rows: configuredRows },
    { title: "Project", rows: projectRows },
  ];
}
