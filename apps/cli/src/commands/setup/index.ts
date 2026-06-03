import { Flags } from "@oclif/core";
import { intro, outro } from "@clack/prompts";
import { consola } from "consola";

import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import { ZitadelError } from "../../lib/errors";
import { createOrca, issuerFromPort, type FrameworkFacts, type Orca } from "../../lib/orca";
import type { PatchContext } from "../../lib/orca/patchers/types";
import { RENDERER_IDS } from "../../lib/orca/patchers/rule/next/renderers/registry";
import type { CreateProject201 } from "@zitadel/api/generated/model";
import { createZitadelClient } from "@zitadel/api/client";

import { hasZitadelConfig, hasZitadelSecret } from "../../lib/project";
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
 * by flags, creates the remote project (whose default user schema and login
 * flow are provisioned server-side), and patches the local files via
 * `Orca`'s framework patcher.
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
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Setup);
    await this.toMeta(flags);
    const { cwd, nonInteractive, dryRun, force } = this.meta;

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

    // `POST /projects` is unauthenticated. Creating the project also
    // provisions its default user schema and login flow server-side, so the
    // CLI no longer builds, scaffolds, or uploads those resources here.
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
      server: answers.server,
    };
    consola.start(`Patching project files${dryRun ? " (dry run)" : ""}`);
    const result = await orca.patcherFor(framework.id).patch(ctx, { cwd, dryRun, force });
    for (const file of result.filesWritten) {
      const sentence = describeWrittenFile(relativeDisplay(cwd, file), dryRun);
      if (sentence) consola.info(sentence);
    }
    for (const file of result.filesSkipped) {
      consola.info(`Left ${relativeDisplay(cwd, file)} unchanged (already matches target)`);
    }
    consola.success(
      `Patched ${result.filesWritten.length} file${result.filesWritten.length === 1 ? "" : "s"}` +
        (result.filesSkipped.length > 0 ? ` (${result.filesSkipped.length} unchanged)` : ""),
    );

    const writtenRel = result.filesWritten.map((file) => relativeDisplay(cwd, file));
    // The structured report is human-only. Under `--json` we let the
    // envelope returned from `this.emit(...)` be the sole stdout
    // payload (oclif requires single-doc JSON).
    if (!this.jsonEnabled()) {
      const projectFacts = await detectProjectFacts(cwd, framework.id);
      const sections = buildSummary({
        projectFacts,
        writtenRel,
        project,
        server: answers.server,
        issuer,
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

/**
 * Picks one written file by suffix so the corresponding INSTALLED row can
 * reference it without hard-coding the path the patcher chose. Returns
 * the first match; falls back to `undefined` when the patcher didn't
 * write that artifact (e.g. a renderer without a register page).
 */
function pickWrittenFile(written: string[], suffix: string): string | undefined {
  return written.find((file) => file.endsWith(suffix));
}

/**
 * Translates a patcher-written path into a single sentence the user can
 * read at narration speed. Returns `null` for directories and other
 * scaffolding artefacts that aren't worth narrating individually — the
 * file count in the closing `success(...)` and the summary's INSTALLED
 * section already cover them. The verb tense flips for `--dry-run` so
 * the user sees a preview ("Would write ...") instead of a claim that
 * something happened.
 */
function describeWrittenFile(relPath: string, dryRun: boolean): string | null {
  // Mkdir ops surface in `filesWritten` alongside actual file writes.
  // They're noise at the per-step layer (the files inside them get
  // narrated on their own lines), so swallow them here.
  if (
    relPath === ".zitadel" ||
    relPath === ".zitadel/flows" ||
    relPath === ".zitadel/schemas"
  ) {
    return null;
  }
  const verb = dryRun ? "Would write" : "Wrote";
  const sentence = SENTENCE_BY_PATH[relPath];
  if (sentence) {
    return `${verb} ${sentence.subject} (${stylePath(relPath)})`;
  }
  return `${verb} ${stylePath(relPath)}`;
}

/**
 * Map from the patcher's deterministic output paths to a short noun
 * phrase describing what the file is for. Anything not in the map falls
 * back to the bare path in the narration; add an entry here when a new
 * scaffolded file deserves a clearer label.
 */
const SENTENCE_BY_PATH: Record<string, { subject: string }> = {
  ".gitignore": { subject: "the project's .gitignore additions" },
  ".zitadel/secret": { subject: "the local project secret" },
  "zitadel.json": { subject: "the Zitadel project configuration" },
  ".env.example": { subject: "the .env example template" },
  ".env.local": { subject: "the local development environment variables" },
  ".zitadel/state.json": { subject: "the empty sync state file" },
  "app/login/page.tsx": { subject: "the login page" },
  "app/register/page.tsx": { subject: "the registration page" },
  "app/profile/page.tsx": { subject: "the profile page" },
  "middleware.ts": { subject: "the Next.js middleware" },
  "custom-elements.d.ts": { subject: "the web-component type declarations" },
  "package.json": { subject: "package.json with the SDK dependency" },
};

/** Builds the section list driving {@link renderSummary} for the setup command. */
function buildSummary(opts: {
  projectFacts: Awaited<ReturnType<typeof detectProjectFacts>>;
  writtenRel: string[];
  project: CreateProject201;
  server: string;
  issuer: string;
  scaffoldedFramework: boolean;
}): Section[] {
  const { projectFacts, writtenRel, project, server, issuer, scaffoldedFramework } = opts;
  const sdkPackage = "@zitadel/sdk-next";
  const packageJsonHit = pickWrittenFile(writtenRel, "package.json");

  const detected: Row[] = [
    { label: "Framework", value: formatFrameworkLine(projectFacts) },
  ];
  if (scaffoldedFramework) {
    detected.push({ label: "Scaffold", value: "fresh project (no existing files)" });
  }

  const installedRows: Row[] = [];
  if (packageJsonHit) {
    installedRows.push({
      label: "Package",
      value: sdkPackage,
      secondary: stylePath(fileNameOf(packageJsonHit)),
    });
  }
  for (const [label, suffix] of [
    ["Login page", "app/login/page.tsx"],
    ["Register page", "app/register/page.tsx"],
    ["Profile page", "app/profile/page.tsx"],
    ["Middleware", "middleware.ts"],
    ["Env vars", ".env.local"],
  ] as const) {
    const hit = pickWrittenFile(writtenRel, suffix);
    if (hit) installedRows.push({ label, value: stylePath(hit) });
  }

  const projectRows: Row[] = [
    { label: "Project id", value: styleId(project.id) },
    { label: "Server", value: styleUrl(server) },
    { label: "App will run", value: styleUrl(issuer) },
  ];

  return [
    { title: "Detected", rows: detected },
    { title: "Installed", rows: installedRows },
    { title: "Project", rows: projectRows },
  ];
}
