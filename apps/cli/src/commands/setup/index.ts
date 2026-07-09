import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

import { intro, outro } from "@clack/prompts";
import { Flags } from "@oclif/core";
import { createZitadelClient } from "@zitadel/api/client";
import type { CreateProject201 } from "@zitadel/api/generated/model";
import {
  DEFAULT_SETUP_PRESET,
  SETUP_PRESETS,
  type SetupPreset,
} from "@zitadel/config/defaults";
import { consola } from "consola";

import { toZitadelError, ZitadelError } from "../../lib/errors";
import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import {
  createOrca,
  inspectScaffoldTarget,
  issuerFromPort,
  type FrameworkFacts,
  type Orca,
  type ScaffoldTarget,
} from "../../lib/orca";
import { RENDERER_IDS } from "../../lib/orca/patchers/rule/next/renderers/registry";
import type { PatchContext } from "../../lib/orca/patchers/types";
import { hasZitadelConfig, hasZitadelSecret } from "../../lib/project";
import { publicCliCommand } from "../../lib/public-cli";
import {
  materializeSetupResources,
  type MaterializeSetupResourcesResult,
} from "../../lib/setup-resources";
import { installDependenciesForSetup } from "./install";
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
 * by flags, creates the remote project without server fallback defaults,
 * patches the local files via `Orca`'s framework patcher, then scaffolds and
 * uploads editable schema/flow config from `.zitadel/**`.
 *
 * Every interactive question lives in {@link SETUP_PROMPTS} (the main wizard
 * — each entry is a small class) and {@link PickFrameworkPrompt} (the
 * empty-directory framework choice, before the main wizard).
 */
export default class Setup extends BaseCommand {
  static override description = "Create a Zitadel project and scaffold local auth.";
  static override examples = [
    "<%= config.bin %> setup --framework next",
    "<%= config.bin %> setup --framework react --dev-port 3000",
  ];
  static override flags = {
    framework: Flags.string({ description: "Framework to target.", options: FRAMEWORK_OPTIONS }),
    renderer: Flags.string({
      description: "Renderer (default: react).",
      options: [...RENDERER_IDS],
    }),
    "dev-port": Flags.integer({
      description:
        "Dev-server port; also the issuer origin registered with Zitadel. Defaults to the detected port. Use distinct ports to run several scaffolded apps side by side.",
    }),
    "skip-install": Flags.boolean({
      description: "Do not install dependencies after setup updates package.json.",
    }),
    preset: Flags.string({
      description:
        "Sign-in preset for the scaffolded schema and login flow (default: password-first).",
      options: [...SETUP_PRESETS],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Setup);
    try {
      await this.toMeta(flags);
    } catch (error) {
      throw localSetupHint(error, flags.framework, this.config.version);
    }
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
      consola.success(
        `Detected ${framework.id}${framework.devPort ? ` (dev port ${framework.devPort})` : ""}`,
      );
    } catch (error) {
      if (
        error instanceof ZitadelError &&
        error.code === "E_FRAMEWORK_NOT_DETECTED"
      ) {
        const target = await inspectScaffoldTarget(cwd);
        if (!target.scaffoldable) {
          throw frameworkDetectionWithScaffoldTarget(error, cwd, target);
        }
        consola.info("Fresh app directory — scaffolding a fresh project");
        framework = await orca.scaffold(
          cwd,
          await resolveScaffoldFramework(flags.framework, nonInteractive, orca),
        );
        scaffoldedFramework = true;
        consola.success(`Scaffolded ${framework.id} skeleton`);
      } else {
        throw error;
      }
    }

    this.recordTelemetry({
      framework: framework.id,
      renderer: flags.renderer ?? "react",
      scaffolded_skeleton: scaffoldedFramework,
      skip_install: Boolean(flags["skip-install"]),
      dev_port_explicit: flags["dev-port"] !== undefined,
      preset: flags.preset ?? DEFAULT_SETUP_PRESET,
      step: "framework_resolved",
    });

    // An explicit --dev-port overrides the detected port for the whole run, so
    // the issuer and the registered origin track the requested port (and several
    // apps can be scaffolded on distinct ports). The config edits set the
    // dev-server port only when it is unset, so a project that already pins a
    // different port in vite.config.*/angular.json keeps it — pass --dev-port to
    // match that pin (or remove it) if the origin check rejects requests.
    if (flags["dev-port"] !== undefined) {
      const devPort = flags["dev-port"];
      if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
        throw new ZitadelError(
          "E_VALIDATION",
          `--dev-port must be an integer in 1..65535, got ${devPort}`,
        );
      }
      framework = {
        ...framework,
        devPort,
        url: issuerFromPort(devPort),
      };
    }

    let answers: SetupAnswers = {
      server: this.meta.source,
      devPort: framework.devPort,
      preset: (flags.preset as SetupPreset | undefined) ?? DEFAULT_SETUP_PRESET,
    };

    if (!nonInteractive && !dryRun) {
      intro("Zitadel setup");
      const promptCtx = {
        framework,
        serverFlag: this.meta.serverFlag,
        devPortFromFlag: flags["dev-port"] !== undefined,
        presetFromFlag: flags.preset !== undefined,
      };
      for (const prompt of SETUP_PROMPTS) {
        answers = await prompt.ask(answers, promptCtx);
      }
      outro("Configuration captured");
    }

    // The interactive prompt can override the flag/default preset recorded at
    // framework_resolved — re-record so telemetry carries the preset that
    // actually scaffolds.
    this.recordTelemetry({ preset: answers.preset });

    const issuer = issuerFromPort(answers.devPort);
    // The DevPortPrompt can change the port interactively, so fold the answer
    // back into the framework: the patched dev-server config reads
    // `framework.devPort`, and it must agree with the issuer and the registered
    // origin (both derived from `answers.devPort`).
    framework = { ...framework, devPort: answers.devPort, url: issuer };

    // `POST /projects` is unauthenticated. CLI-managed projects opt out of
    // server fallback defaults, then setup uploads the local default schema and
    // flow files through the typed resource APIs and records the returned IDs.
    consola.start(`Creating project on ${answers.server}${dryRun ? " (dry run)" : ""}`);
    const unauthClient = createZitadelClient({ baseUrl: answers.server });
    const projectName = defaultProjectName(cwd, framework.id);
    // Register the app's own origin so the backend's origin check allows
    // requests the dev proxy forwards from it.
    const project = dryRun
      ? dryRunProject(issuer)
      : await createProjectWithLocalHint(
          unauthClient,
          answers.server,
          this.meta.cliVersion,
          projectName,
          issuer,
          framework.id,
        );
    consola.success(`Created project ${project.id}`);
    this.recordTelemetry({ step: "project_created" });

    const ctx: PatchContext = {
      framework,
      rendererId: flags.renderer ?? "react",
      project,
      issuer,
      server: answers.server,
      cliVersion: this.meta.cliVersion,
      scaffoldedFramework,
      preset: answers.preset,
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
    let resourceResult: MaterializeSetupResourcesResult;
    try {
      resourceResult = dryRun
        ? { filesWritten: [] }
        : await materializeSetupResources({
            cwd,
            client: createZitadelClient({ baseUrl: answers.server, token: project.projectSecret }),
            projectId: project.id,
            force,
            preset: answers.preset,
          });
    } catch (error) {
      // Setup is not atomic: the patcher already wrote `zitadel.json` (the
      // marker the already-initialized guard skips on) and `.zitadel/secret`.
      // Remove both so a rerun starts a fresh setup instead of being skipped
      // forever with no default schema or login flow anywhere. The
      // half-provisioned project has no usable resources, so its credentials
      // are not worth keeping.
      await rm(join(cwd, "zitadel.json"), { force: true });
      await rm(join(cwd, ".zitadel/secret"), { force: true });
      const cause = toZitadelError(error);
      throw new ZitadelError(cause.code, `Default resource setup failed: ${cause.message}`, {
        hint:
          "The project was created but its default schema/flow upload did not finish. " +
          "Re-run `zitadel setup` to start over (add --force to overwrite partially " +
          "written .zitadel files).",
        nextCommands: ["zitadel setup --force"],
        details: cause.details,
      });
    }
    for (const file of resourceResult.filesWritten) {
      const sentence = describeWrittenFile(relativeDisplay(cwd, file), dryRun);
      if (sentence) consola.info(sentence);
    }
    const allFilesWritten = [...result.filesWritten, ...resourceResult.filesWritten];
    consola.success(
      `Patched ${allFilesWritten.length} file${allFilesWritten.length === 1 ? "" : "s"}` +
        (result.filesSkipped.length > 0 ? ` (${result.filesSkipped.length} unchanged)` : ""),
    );
    this.recordTelemetry({
      step: "files_patched",
      files_written_count: allFilesWritten.length,
    });

    const installOutcome = await installDependenciesForSetup({
      cliVersion: this.meta.cliVersion,
      cwd,
      depsAdded: result.depsAdded,
      dryRun,
      env: this.meta.env,
      issuer,
      json: this.jsonEnabled(),
      scaffoldedFramework,
      skipInstall: Boolean(flags["skip-install"]),
    });

    this.recordTelemetry({
      step: "dependencies_installed",
      package_manager: installOutcome.install.package_manager,
    });

    const writtenRel = allFilesWritten.map((file) => relativeDisplay(cwd, file));
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
        message: [renderSummary(sections), "", installOutcome.nextActions.join("\n")].join("\n"),
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
        files_written: allFilesWritten.map((file) => relativeDisplay(cwd, file)),
        files_skipped: result.filesSkipped.map((file) => relativeDisplay(cwd, file)),
        install: installOutcome.install,
        next_actions: installOutcome.nextActions,
        next_commands: installOutcome.nextCommands,
      },
    });
  }
}

function frameworkDetectionWithScaffoldTarget(
  error: ZitadelError,
  cwd: string,
  target: ScaffoldTarget,
): ZitadelError {
  return new ZitadelError(
    error.code,
    "Could not detect a supported app framework, and this directory is not a fresh scaffold target",
    {
      hint:
        `${target.reason ?? "Directory is not empty."} ` +
        "Run setup from an empty directory to scaffold a new app, or run setup from an existing supported app project.",
      details: { cwd, entries: target.entries, reason: target.reason },
    },
  );
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
      hint: "Run without --json/--non-interactive to choose from a prompt, or pass --framework for scripted setup.",
    });
  }
  return new PickFrameworkPrompt().ask(orca.availableFrameworks());
}

/** A deterministic stand-in project for `--dry-run`, so no remote call is made. */
function dryRunProject(issuer: string): CreateProject201 {
  return {
    id: "dry-run-0000",
    projectSecret: "sk_proj_dry_run_full",
    previewSecret: "sk_proj_dry_run_preview",
    previewOrigins: [issuer],
    createdAt: "2026-04-21T14:03:11.000Z",
  };
}

async function createProjectWithLocalHint(
  client: ReturnType<typeof createZitadelClient>,
  server: string,
  cliVersion: string,
  projectName: string,
  issuer: string,
  framework: string,
): Promise<CreateProject201> {
  try {
    // API contract requires a project name; generated TS models may lag
    // briefly until `packages/api` regeneration catches up.
    const payload = { name: projectName, previewOrigins: [issuer], seedDefaults: false } as {
      name: string;
      previewOrigins: string[];
      seedDefaults: false;
    };
    // Register the app's own origin so the backend's origin check allows the
    // requests the dev proxy forwards from it.
    return await client.createProject(payload as Parameters<typeof client.createProject>[0]);
  } catch (error) {
    const normalized = toZitadelError(error);
    throw new ZitadelError(normalized.code, normalized.message, {
      hint:
        `${normalized.hint ? `${normalized.hint} ` : ""}` +
        "If you meant to use a local Zitadel server, start it first " +
        `and retry setup with --framework ${framework} --server local.`,
      nextCommands: [
        publicCliCommand("start", cliVersion),
        publicCliCommand(`setup --framework ${framework} --server local`, cliVersion),
      ],
      details: {
        server,
        original: normalized.details,
      },
    });
  }
}

function defaultProjectName(cwd: string, framework: string): string {
  const fromDirectory = basename(cwd).trim();
  return fromDirectory.length > 0 ? fromDirectory : `zitadel-${framework}-app`;
}

function localSetupHint(error: unknown, framework: string | undefined, cliVersion: string): unknown {
  const normalized = toZitadelError(error);
  if (normalized.code !== "E_LOCAL_SERVER_NOT_RUNNING") {
    return error;
  }

  const setupCommand = framework
    ? `setup --framework ${framework} --server local`
    : "setup --server local";

  return new ZitadelError(normalized.code, normalized.message, {
    hint:
      `${normalized.hint ? `${normalized.hint} ` : ""}` +
      "Start local Zitadel first, then rerun setup. " +
      "After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
    nextCommands: [
      publicCliCommand("start", cliVersion),
      publicCliCommand(setupCommand, cliVersion),
    ],
    details: normalized.details,
  });
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
  if (relPath === ".zitadel" || relPath === ".zitadel/flows" || relPath === ".zitadel/schemas") {
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
  ".zitadel/flows/default-login.json": { subject: "the editable default login flow" },
  ".zitadel/flows/README.md": { subject: "the flows folder README" },
  ".zitadel/schemas/default-human-user.json": {
    subject: "the editable default human user schema",
  },
  ".zitadel/schemas/README.md": { subject: "the schemas folder README" },
  "app/page.tsx": { subject: "the home page redirect" },
  "app/login/page.tsx": { subject: "the login page" },
  "app/register/page.tsx": { subject: "the registration page" },
  "app/profile/page.tsx": { subject: "the profile page" },
  "middleware.ts": { subject: "the Next.js middleware" },
  "proxy.ts": { subject: "the Next.js proxy" },
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

  const detected: Row[] = [{ label: "Framework", value: formatFrameworkLine(projectFacts) }];
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
    ["Home redirect", "app/page.tsx"],
    ["Login page", "app/login/page.tsx"],
    ["Register page", "app/register/page.tsx"],
    ["Profile page", "app/profile/page.tsx"],
    ["Request proxy", "proxy.ts"],
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
