import { rm } from "node:fs/promises";
import { basename, join } from "node:path";

import { intro, outro } from "@clack/prompts";
import { Flags } from "@oclif/core";
import { createZitadelClient } from "@zitadel/api/client";
import type { CreateProject201 } from "@zitadel/api/generated/model";
import {
  BRANDING_DESIGNS,
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  SETUP_PRESETS,
  SETUP_USE_CASES,
  type BrandingDesign,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import { consola } from "consola";

import { brandingDesignLabel } from "../../lib/branding/designs";
import { claimAction, claimCommand, claimState } from "../../lib/claim-state";
import { toZitadelError, ZitadelError } from "../../lib/errors";
import { brandingGuidanceAction } from "../../lib/journey-guidance";
import { BaseCommand, type JsonEnvelope } from "../../lib/oclif";
import {
  createOrca,
  inspectScaffoldTarget,
  issuerFromPort,
  type FrameworkFacts,
  type Orca,
  type ScaffoldTarget,
} from "../../lib/orca";
import {
  AVAILABLE_RENDERER_IDS,
  RENDERER_IDS,
} from "../../lib/orca/patchers/rule/next/renderers/registry";
import type { PatchContext } from "../../lib/orca/patchers/types";
import { hasZitadelConfig, hasZitadelSecret } from "../../lib/project";
import { publicCliCommand } from "../../lib/public-cli";
import { derivePosture } from "../../lib/orca/patchers/posture";
import { writeScaffoldManifest } from "../../lib/scaffold-manifest";
import {
  materializeSetupResources,
  type MaterializeSetupResourcesResult,
} from "../../lib/setup-resources";
import { installDependenciesForSetup } from "./install";
import { PickFrameworkPrompt, SETUP_PROMPTS, type SetupAnswers } from "./prompts";
import {
  designWarnings,
  detectProjectFacts,
  dim as styleDim,
  fileNameOf,
  formatFrameworkLine,
  id as styleId,
  path as stylePath,
  relativeDisplayPath as relativeDisplay,
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

/**
 * `--renderer` offers only ids `getRenderer` will resolve: a
 * declared-but-unpublished renderer (ADR 006) keeps its registry entry to
 * reserve the id, but is surfaced as unavailable in the flag description
 * instead of in `options`, so `--help` never advertises a value that is
 * guaranteed to fail and an explicit pass is rejected at parse time — before
 * any remote project is created.
 */
const UNAVAILABLE_RENDERER_IDS = RENDERER_IDS.filter(
  (id) => !AVAILABLE_RENDERER_IDS.includes(id),
);
const RENDERER_FLAG_DESCRIPTION =
  UNAVAILABLE_RENDERER_IDS.length === 0
    ? "Renderer (default: react)."
    : `Renderer (default: react). Not yet available: ${UNAVAILABLE_RENDERER_IDS.join(", ")}.`;

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
      description: RENDERER_FLAG_DESCRIPTION,
      options: [...AVAILABLE_RENDERER_IDS],
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
    "use-case": Flags.string({
      description:
        "Use case for the scaffolded schema fields: who signs in to the app (default: minimal).",
      options: [...SETUP_USE_CASES],
    }),
    design: Flags.string({
      description:
        "Login design to eject into .zitadel/branding/ and publish as branding revision 1. Skips the wizard's design question. When omitted in non-interactive runs, the login uses the built-in template; run the `branding eject` command later to customize. Split-family designs (split, split-right, hero) collapse their brand pane by container width: narrow containers — including widget-posture embeds at card width — render the compact brand mark instead (logo_url, else hero_url, from .zitadel/branding/branding.json; hero falls back to editable text).",
      options: [...BRANDING_DESIGNS],
    }),
  };

  async run(): Promise<JsonEnvelope> {
    const { flags } = await this.parse(Setup);
    try {
      await this.toMeta(flags);
    } catch (error) {
      throw localSetupHint(error, retryOptionsFromFlags(flags), this.config.version);
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
      use_case: flags["use-case"] ?? DEFAULT_SETUP_USE_CASE,
      design: flags.design ?? "built-in",
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
      useCase: (flags["use-case"] as SetupUseCase | undefined) ?? DEFAULT_SETUP_USE_CASE,
      design: flags.design as BrandingDesign | undefined,
    };

    if (!nonInteractive && !dryRun) {
      intro("Zitadel setup");
      const promptCtx = {
        framework,
        cwd,
        serverFlag: this.meta.serverFlag,
        devPortFromFlag: flags["dev-port"] !== undefined,
        presetFromFlag: flags.preset !== undefined,
        useCaseFromFlag: flags["use-case"] !== undefined,
        designFromFlag: flags.design !== undefined,
      };
      for (const prompt of SETUP_PROMPTS) {
        answers = await prompt.ask(answers, promptCtx);
      }
      outro("Configuration captured");
    }

    // The interactive prompts can override the flag/default preset, use
    // case, and design recorded at framework_resolved — re-record so
    // telemetry carries the values that actually scaffold.
    this.recordTelemetry({
      preset: answers.preset,
      use_case: answers.useCase,
      design: answers.design ?? "built-in",
    });

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
          {
            // Resolved values, not raw flags: the wizard may have picked the
            // preset, design, or dev port interactively, and the retry must
            // reproduce those choices — the issuer registered with the
            // project derives from the port.
            ...retryOptionsFromFlags(flags),
            framework: framework.id,
            preset: answers.preset,
            useCase: answers.useCase,
            design: answers.design,
            devPort: answers.devPort,
          },
        );
    consola.success(`Created project ${project.id}`);
    this.recordTelemetry({ step: "project_created" });

    // Fresh scaffolds keep the widgets' full-page chrome; a pre-existing
    // route-based app gets embeddable cards inside its own layout (ADR 044).
    const posture = derivePosture(framework.id, scaffoldedFramework);
    const ctx: PatchContext = {
      framework,
      rendererId: flags.renderer ?? "react",
      project,
      issuer,
      server: answers.server,
      cliVersion: this.meta.cliVersion,
      scaffoldedFramework,
      posture,
      preset: answers.preset,
      useCase: answers.useCase,
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
            client: createZitadelClient({ baseUrl: answers.server, token: project.project_secret }),
            projectId: project.id,
            force,
            preset: answers.preset,
            useCase: answers.useCase,
            design: answers.design,
            cliVersion: this.meta.cliVersion,
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

    if (!dryRun) {
      // Record what was actually scaffolded so `doctor` can later verify the
      // app files without guessing from current templates (missing vs edited
      // vs user-adopted) and `doctor --fix` can restore exactly the missing
      // ones. Best-effort: a failure here only degrades doctor to its
      // template-derived fallback, it never breaks setup.
      try {
        await writeScaffoldManifest({
          cwd,
          actions: orca.patcherFor(framework.id).artifacts({
            framework,
            rendererId: ctx.rendererId,
          }),
          written: [...result.filesWritten, ...result.filesSkipped],
          scaffoldedFramework,
          devPort: answers.devPort,
          posture,
        });
      } catch (error) {
        consola.debug("Failed to record the scaffold manifest", error);
      }
    }

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
    // The nudge rides both surfaces from one decision: the box for humans, the
    // envelope for agents.
    //
    // It joins `boxActions` rather than being held back from it. That list is
    // journey-staged by *omission* (customize/publish is absent until login
    // works, see `install.ts`), and this is not part of that journey: attaching
    // a team is orthogonal to whether login works yet, exactly as in `status`.
    // Position in the list carries no staging meaning, so appending is not a
    // way of deferring it.
    //
    // Empty off the cloud, where nothing can be attached.
    const claimNudge =
      claimState({ secret: {}, server: answers.server }).kind === "detached"
        ? {
            actions: [claimAction(this.meta.cliVersion)],
            commands: [claimCommand(this.meta.cliVersion)],
          }
        : { actions: [], commands: [] };
    // The structured report is human-only. Under `--json` we let the
    // envelope returned from `this.emit(...)` be the sole stdout
    // payload (oclif requires single-doc JSON).
    // The split-family brand pane collapses to the compact brand mark once the
    // login's container is narrow — and the template only emits that mark when
    // branding.json names an asset. Say so at setup time instead of letting the
    // branding's absence read as a rendering bug. Keyed to the design alone:
    // the collapse is a container query, so posture doesn't decide it (see
    // `designWarnings`).
    const warnings = designWarnings(answers.design);
    if (!this.jsonEnabled()) {
      const projectFacts = await detectProjectFacts(cwd, framework.id);
      const sections = buildSummary({
        projectFacts,
        writtenRel,
        project,
        server: answers.server,
        issuer,
        scaffoldedFramework,
        design: answers.design,
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
          [...installOutcome.boxActions, ...claimNudge.actions].join("\n"),
        ].join("\n"),
        style: { padding: 1, borderStyle: "rounded", borderColor: "green" },
      });
      // The envelope's `warnings` never render in non-JSON mode (setup
      // passes `pretty: ""`), so surface them to humans here.
      for (const warning of warnings) {
        consola.warn(warning);
      }
    }

    return this.emit({
      status: "ok",
      warnings,
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
        // Typed per-artifact rows for the scaffolded app files (the sync
        // resources continue to report through files_written): one row per
        // touched path with kind (file/dir) and action (create/update), so
        // agents can verify what setup did without parsing narration.
        files: result.files.map((file) => ({
          path: relativeDisplay(cwd, file.path),
          kind: file.kind,
          action: file.action,
        })),
        files_skipped: result.filesSkipped.map((file) => relativeDisplay(cwd, file)),
        install: installOutcome.install,
        // The chosen login design, or null for the built-in template — so
        // agents can verify what setup published without diffing the repo.
        design: answers.design ?? null,
        // Branding guidance before the claim nudge: make it yours, then
        // claim to keep it (the same order the manifesto's journey walks).
        next_actions: [
          ...installOutcome.nextActions,
          brandingGuidanceAction(answers.design, this.meta.cliVersion),
          ...claimNudge.actions,
        ],
        next_commands: [...installOutcome.nextCommands, ...claimNudge.commands],
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
    project_secret: "sk_proj_dry_run_full",
    preview_secret: "sk_proj_dry_run_preview",
    preview_origins: [issuer],
    created_at: "2026-04-21T14:03:11.000Z",
  };
}

/**
 * The parts of a setup invocation that a retry suggestion must reproduce.
 * Suggested retries are followed verbatim (especially by agents), so dropping
 * a flag here silently changes what the retry scaffolds.
 */
type SetupRetryOptions = {
  framework?: string;
  preset?: SetupPreset;
  useCase?: SetupUseCase;
  design?: string;
  renderer?: string;
  devPort?: number;
  nonInteractive?: boolean;
};

/**
 * Reconstructs the flag list of the current invocation for retry guidance,
 * ending in `--server local`. Flags whose resolved value equals the default
 * are omitted — the retry reproduces the same outcome without them.
 */
function setupRetryFlags(opts: SetupRetryOptions): string {
  const parts: string[] = [];
  if (opts.framework) {
    parts.push(`--framework ${opts.framework}`);
  }
  if (opts.preset && opts.preset !== DEFAULT_SETUP_PRESET) {
    parts.push(`--preset ${opts.preset}`);
  }
  if (opts.useCase && opts.useCase !== DEFAULT_SETUP_USE_CASE) {
    parts.push(`--use-case ${opts.useCase}`);
  }
  if (opts.design) {
    parts.push(`--design ${opts.design}`);
  }
  if (opts.renderer && opts.renderer !== "react") {
    parts.push(`--renderer ${opts.renderer}`);
  }
  if (opts.devPort !== undefined) {
    parts.push(`--dev-port ${opts.devPort}`);
  }
  if (opts.nonInteractive) {
    parts.push("--non-interactive");
  }
  parts.push("--server local");
  return parts.join(" ");
}

/**
 * Retry options straight from parsed flags, for failures before the wizard
 * resolves answers. `--non-interactive` is echoed only when explicitly passed
 * — TTY/JSON-inferred non-interactivity re-infers itself on the retry.
 */
function retryOptionsFromFlags(flags: {
  framework?: string;
  preset?: string;
  "use-case"?: string;
  design?: string;
  renderer?: string;
  "dev-port"?: number;
  "non-interactive"?: boolean;
}): SetupRetryOptions {
  return {
    framework: flags.framework,
    preset: flags.preset as SetupPreset | undefined,
    useCase: flags["use-case"] as SetupUseCase | undefined,
    design: flags.design,
    renderer: flags.renderer,
    devPort: flags["dev-port"],
    nonInteractive: Boolean(flags["non-interactive"]),
  };
}

async function createProjectWithLocalHint(
  client: ReturnType<typeof createZitadelClient>,
  server: string,
  cliVersion: string,
  projectName: string,
  issuer: string,
  retry: SetupRetryOptions,
): Promise<CreateProject201> {
  try {
    // API contract requires a project name; generated TS models may lag
    // briefly until `packages/api` regeneration catches up.
    const payload = { name: projectName, preview_origins: [issuer], seed_defaults: false } as {
      name: string;
      preview_origins: string[];
      seed_defaults: false;
    };
    // Register the app's own origin so the backend's origin check allows the
    // requests the dev proxy forwards from it.
    return await client.createProject(payload as Parameters<typeof client.createProject>[0]);
  } catch (error) {
    const normalized = toZitadelError(error);
    const retryFlags = setupRetryFlags(retry);
    throw new ZitadelError(normalized.code, normalized.message, {
      hint:
        `${normalized.hint ? `${normalized.hint} ` : ""}` +
        "If you meant to use a local Zitadel server, start it first " +
        `and retry setup with ${retryFlags}.`,
      nextCommands: [
        publicCliCommand("start", cliVersion),
        publicCliCommand(`setup ${retryFlags}`, cliVersion),
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

function localSetupHint(error: unknown, retry: SetupRetryOptions, cliVersion: string): unknown {
  const normalized = toZitadelError(error);
  if (normalized.code !== "E_LOCAL_SERVER_NOT_RUNNING") {
    return error;
  }

  const setupCommand = `setup ${setupRetryFlags(retry)}`;

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
 * read at narration speed. The patch result's `filesWritten` carries
 * deduplicated file paths only (directories stay in the typed `files`
 * rows), so no artefact filtering is needed here. The verb tense flips
 * for `--dry-run` so the user sees a preview ("Would write ...") instead
 * of a claim that something happened.
 */
function describeWrittenFile(relPath: string, dryRun: boolean): string | null {
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
  ".zitadel/state.json": { subject: "the sync state file" },
  ".zitadel/flows/default-login.json": { subject: "the editable default login flow" },
  ".zitadel/flows/README.md": { subject: "the flows folder README" },
  ".zitadel/schemas/default-human-user.json": {
    subject: "the editable default human user schema",
  },
  ".zitadel/schemas/README.md": { subject: "the schemas folder README" },
  ".zitadel/meta/flow-definition.json": { subject: "the flow dialect spec (editor $schema)" },
  ".zitadel/meta/user-schema.json": { subject: "the user-schema dialect spec" },
  ".zitadel/meta/user-property.json": { subject: "the user-property dialect spec" },
  ".zitadel/meta/branding.json": { subject: "the branding dialect spec" },
  ".zitadel/branding/branding.json": { subject: "the branding descriptor (layout + asset URLs)" },
  ".zitadel/branding/login.liquid": { subject: "the editable login template" },
  ".zitadel/branding/README.md": { subject: "the branding folder README" },
  "AGENTS.md": { subject: "the agent guidance (golden journey + config dialect)" },
  "README.md": { subject: "the README's Zitadel section" },
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
  design?: BrandingDesign;
}): Section[] {
  const { projectFacts, writtenRel, project, server, issuer, scaffoldedFramework, design } = opts;
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

  // The login-customization entry points. These are what a user edits to
  // change what the login collects, how it authenticates, and how it looks —
  // burying them in the verbose per-file narration above the box means users
  // don't find them (each folder ships a README with the workflow).
  const customizeRows: Row[] = [];
  for (const [label, suffix, dir] of [
    ["User schema", ".zitadel/schemas/default-human-user.json", ".zitadel/schemas/"],
    ["Login flow", ".zitadel/flows/default-login.json", ".zitadel/flows/"],
    ["Login template", ".zitadel/branding/login.liquid", ".zitadel/branding/"],
  ] as const) {
    const hit = pickWrittenFile(writtenRel, suffix);
    if (hit) customizeRows.push({ label, value: stylePath(dir), secondary: "see its README.md" });
  }

  const projectRows: Row[] = [
    { label: "Project id", value: styleId(project.id) },
    { label: "Server", value: styleUrl(server) },
    { label: "App will run", value: styleUrl(issuer) },
    design
      ? {
          label: "Login design",
          value: brandingDesignLabel(design),
          secondary: `${design} · ${stylePath(".zitadel/branding/")}`,
        }
      : { label: "Login design", value: styleDim("built-in template") },
  ];

  return [
    { title: "Detected", rows: detected },
    { title: "Installed", rows: installedRows },
    { title: "Customize", rows: customizeRows },
    { title: "Project", rows: projectRows },
  ];
}
