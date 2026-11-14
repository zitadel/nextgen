import type { Fact } from "@/cli/commands/setup/shared";
import { accepts, parses, type Refused, reads, whole } from "@/lib/oclif/flags";
import { errorMessage } from "@/lib/errors";
import { reportWarning } from "@/lib/warnings";
import { Flags } from "@oclif/core";
import {
  BRANDING_DESIGNS,
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  SETUP_PRESETS,
  SETUP_USE_CASES,
} from "@zitadel/config/defaults";
import {
  type ClientId,
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  parseClientId,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseProviderSelection,
  parseScopes,
  providerOf,
  RESERVED_SLUGS,
  selectionName,
} from "@zitadel/config/idp";
import { z } from "zod";

import {
  customExample,
  customFlagValues,
  givenCustomFlags,
  SETUP_FLAG_KEYS,
  SETUP_FLAG_NAMES,
} from "@/lib/idp";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type CommandResult,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import { projectEnvFile } from "@/lib/oclif/environment-flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { createOrca } from "@/lib/orca";
import {
  AVAILABLE_RENDERER_IDS,
  RENDERER_IDS,
} from "@/lib/orca/patchers/rule/next/renderers/registry";
import type { Scope } from "@/lib/suggestion";
import { PAGE_LAYOUT_HINT, PasswordPolicy, type PasswordMinLength } from "@/lib/zitadel";

import { Wizard } from "@/lib/wizard";

import { ReportAlreadySetUp } from "./steps/report-already-set-up";
import { MakeInitialCommit } from "./steps/make-initial-commit";
import { WriteConfiguration } from "./steps/write-configuration";
import { ApplyDefaults } from "./steps/apply-defaults";
import { DoInitialDeploy } from "./steps/do-initial-deploy";
import { ChooseDevPort } from "./steps/choose-dev-port";
import { ConfirmFramework } from "./steps/confirm-framework";
import { SetPasswordPolicy } from "./steps/set-password-policy";
import { ChooseServer } from "./steps/choose-server";
import { SettleAnswers } from "./steps/settle-answers";
import { ChooseSignIn } from "./steps/choose-sign-in";
import { ChooseSocialSignIn } from "./steps/choose-social-sign-in";
import { ChooseUseCase } from "./steps/choose-use-case";
import { DetectFramework } from "./steps/detect-framework";
import { InstallDependencies } from "./steps/install-dependencies";
import { KeepChanges } from "./steps/keep-changes";
import { WriteManifest } from "./steps/write-manifest";
import { MoveAppPort, RECOVERY_ENV_FILE } from "./steps/move-app-port";
import { ClaimOwnership } from "./steps/claim-ownership";
import { CheckPatch } from "./steps/check-patch";
import { PatchApp } from "./steps/patch-app";
import { PlanConfiguration } from "./steps/plan-configuration";
import { CreateProject } from "./steps/create-project";
import { PublishCredentials } from "./steps/publish-credentials";
import { ShowResult } from "./steps/show-result";
import { ScaffoldApp } from "./steps/scaffold-app";
import { ReadSsoFlags } from "./steps/read-sso-flags";
import { CheckPreconditions } from "./steps/check-preconditions";

/**
 * The refusal for `--design`, which setup no longer takes.
 */
const DESIGN_REMOVED_REFUSAL = {
  message: "setup no longer applies a login template, so --design was removed",
  hint: `Rerun setup without --design. ${PAGE_LAYOUT_HINT} To own the widget's structure after setup, eject one of: ${BRANDING_DESIGNS.join(", ")}.`,
  next: [{ id: "branding:eject" }],
} as const satisfies Refusal;

/**
 * The refusal for `--sso-client-id` without `--sso`.
 */
const CLIENT_ID_NEEDS_SSO_REFUSAL = {
  message: "--sso-client-id needs --sso",
  hint: "Name the provider with --sso, e.g. --sso google.",
} as const satisfies Refusal;

/**
 * The refusal for a custom connection's setting without `--sso`.
 */
const SETTING_NEEDS_SSO_REFUSAL = {
  message: `{flag} needs --sso ${CUSTOM_PROVIDER}`,
  hint: `Name the provider with --sso ${CUSTOM_PROVIDER}.`,
} as const satisfies Refusal;

/**
 * The refusal for a custom connection's settings given with another provider.
 */
const SETTINGS_NEED_CUSTOM_REFUSAL = {
  message: "{names} only applies to a custom connection",
  hint: `Add --sso ${CUSTOM_PROVIDER}, or remove {them}.`,
  details: {
    flags: "{flags}",
  },
} as const satisfies Refusal;

/**
 * The refusal for a custom connection that a script left incomplete.
 */
const CUSTOM_CONNECTION_INCOMPLETE_REFUSAL = {
  message: "A custom connection needs {list}",
  hint: `Describe the connection, e.g. ${customExample(SETUP_FLAG_NAMES)}`,
  details: {
    missing: "{missing}",
  },
} as const satisfies Refusal;

/**
 * The refusal for a provider that a script gave no client id.
 */
const SSO_NEEDS_CLIENT_ID_REFUSAL = {
  message: "--sso {sso} needs --sso-client-id",
  hint: "Register {registration} and pass its client id.",
} as const satisfies Refusal;

/**
 * The frameworks `--framework` accepts, derived from Orca's registry so the
 * flag can't drift from what the CLI can actually scaffold. `createOrca` is
 * pure (it only builds the in-memory registries), so this is safe at module
 * load.
 */
const FRAMEWORK_OPTIONS = createOrca()
  .availableFrameworks()
  .map((framework) => {
    return framework.id;
  });

/**
 * `--renderer` offers only ids `getRenderer` will resolve: a
 * declared-but-unpublished renderer (ADR 006) keeps its registry entry to
 * reserve the id, but is surfaced as unavailable in the flag description
 * instead of in `options`, so `--help` never advertises a value that is
 * guaranteed to fail and an explicit pass is rejected at parse time — before
 * any remote project is created.
 */
const UNAVAILABLE_RENDERER_IDS = RENDERER_IDS.filter((id) => {
  return !AVAILABLE_RENDERER_IDS.includes(id);
});

/**
 * What `--renderer` says about the renderers there are.
 */
const RENDERER_FLAG_DESCRIPTION =
  UNAVAILABLE_RENDERER_IDS.length === 0
    ? "Renderer (default: react)."
    : `Renderer (default: react). Not yet available: ${UNAVAILABLE_RENDERER_IDS.join(", ")}.`;

/**
 * The lowest TCP port a server can listen on.
 */
const MIN_PORT = 1;

/**
 * The highest TCP port a server can listen on.
 */
const MAX_PORT = 65_535;

/**
 * A TCP port, refusing what is not a whole number from 1 to 65535, which is no
 * port a server can listen on.
 */
const PORT = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
} as const satisfies Refused<number>;

/**
 * The flags the command admitted, which every step reads what it needs from.
 */
export type SetupFlags = Admitted<typeof Setup>["flags"];

/**
 * The flags {@link refuseUnusableFlags} reads, as a command reads them.
 */
export type SetupFlagsToCheck = Readonly<
  Partial<
    Pick<
      SetupFlags,
      "design" | "sso" | "ssoSlug" | "ssoDisplayName" | "ssoIssuer" | "ssoScopes"
    > & {
      ssoClientId: string;
    }
  >
>;

/**
 * Refuses a command line setup cannot act on, before anything is detected,
 * created or written: a removed flag, and a set of `--sso` flags that
 * contradict each other or leaves out what nobody can be asked for.
 *
 * @remarks
 * `scripted` says nobody can be asked; a person at a terminal is asked for what
 * is missing instead.
 *
 * @param flags - The flags the command was given.
 * @param scripted - Whether nobody can be asked.
 * @throws A refusal for the first flag that cannot be acted on.
 */
export function refuseUnusableFlags(flags: SetupFlagsToCheck, scripted: boolean): void {
  if (flags.design !== undefined) {
    throw refusalError(DESIGN_REMOVED_REFUSAL, {});
  }
  if (flags.ssoClientId !== undefined && flags.sso === undefined) {
    throw refusalError(CLIENT_ID_NEEDS_SSO_REFUSAL, {});
  }
  const given = givenCustomFlags(customFlagValues(flags, SETUP_FLAG_KEYS), SETUP_FLAG_NAMES);
  if (flags.sso === undefined) {
    if (given[0] !== undefined) {
      throw refusalError(SETTING_NEEDS_SSO_REFUSAL, {
        flag: given[0],
      });
    }
    return;
  }
  if (flags.sso !== CUSTOM_PROVIDER && given.length > 0) {
    throw refusalError(SETTINGS_NEED_CUSTOM_REFUSAL, {
      names: given.join(", "),
      them: new Intl.PluralRules("en").select(given.length) === "one" ? "it" : "them",
      flags: given,
    });
  }
  if (!scripted) {
    return;
  }
  if (flags.sso === CUSTOM_PROVIDER) {
    const missing = [
      SETUP_FLAG_NAMES.slug,
      SETUP_FLAG_NAMES.displayName,
      SETUP_FLAG_NAMES.issuer,
    ].filter((name) => {
      return !given.includes(name);
    });
    if (missing.length > 0) {
      throw refusalError(CUSTOM_CONNECTION_INCOMPLETE_REFUSAL, {
        list: missing.join(", "),
        missing,
      });
    }
  }
  if (flags.ssoClientId === undefined) {
    const entry = flags.sso === CUSTOM_PROVIDER ? undefined : parseProviderSelection(flags.sso);
    const catalog = entry === undefined ? undefined : providerOf(entry);
    throw refusalError(SSO_NEEDS_CLIENT_ID_REFUSAL, {
      sso: flags.sso,
      registration:
        catalog?.consoleUrl === undefined
          ? `a client at ${catalog?.issuer ?? String(flags.ssoIssuer)}`
          : `an OAuth application at ${catalog.consoleUrl}`,
    });
  }
}

/**
 * `zitadel setup` — create a Zitadel project and scaffold local auth.
 *
 * @remarks
 * Runs as a wizard of steps (see `wizard()`): detect the app, ask what the
 * flags left open, create the project, patch the app and write the editable
 * `.zitadel/**` configuration, then publish credentials, install, commit and
 * deploy. An interactive setup ends with a note about the Zitadel agent skills,
 * shown once per machine; set `NO_SKILLS_PROMPT=1` to hide it.
 *
 * `--design` is hidden so scripts and agents passing it get a targeted error
 * pointing at `branding eject` instead of oclif's unknown-flag error.
 */
export default class Setup extends Destructive(BaseCommand) {
  /**
   * What `--help` says the command does.
   */
  static override description =
    "Create a Zitadel project and scaffold local auth. An interactive setup ends with a note about the Zitadel agent skills, shown once per machine; set NO_SKILLS_PROMPT=1 to hide it.";

  /**
   * The group the command index lists it under.
   */
  static override group = CommandGroups.gettingStarted;

  /**
   * Where it sits in its group.
   */
  static override groupOrder = 1;

  /**
   * The heading its help carries.
   */
  static override heading = "Setting up Zitadel";

  /**
   * That it draws as a wizard.
   */
  static override wizard = true;

  /**
   * The examples `--help` shows.
   */
  static override examples = [
    "<%= config.bin %> setup --framework next",
    "<%= config.bin %> setup --framework react --dev-port 3000",
  ];

  /**
   * The flags setup takes.
   */
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Overwrite managed files that already exist, scaffold into a non-empty directory, and remove the previous origin when --dev-port moves the app.",
    }),
    framework: Flags.string({
      description: "Framework to target.",
      options: FRAMEWORK_OPTIONS,
    }),
    renderer: Flags.string({
      description: RENDERER_FLAG_DESCRIPTION,
      options: [...AVAILABLE_RENDERER_IDS],
    }),
    "dev-port": Flags.custom<number>({
      parse: reads(PORT),
    })({
      description:
        "Dev-server port; also the issuer origin registered with Zitadel. Defaults to the detected port. Use distinct ports to run several scaffolded apps side by side. In an app already set up, moves it to this port: the dev script, ZITADEL_ISSUER and the allowed origin.",
    }),
    "skip-install": Flags.boolean({
      description: "Do not install dependencies after setup updates package.json.",
    }),
    git: Flags.boolean({
      allowNo: true,
      default: true,
      description:
        "Commit the project setup writes, initialising a repository first when there is none, so a release records the commit it was built from. Refuses a repository that already has uncommitted work. Use --no-git to leave version control alone.",
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
    design: nonBlankString({ hidden: true }),
    "password-min-length": Flags.custom<PasswordMinLength>({
      parse: parses(PasswordPolicy.parseMinLength, {
        refusal: {
          message: "{problem}",
          hint: "Pass a whole number for {input}, or 0 for none.",
          details: {
            argument: "{input}",
          },
        },
        empty: {
          message: "{input} was given an empty value",
          hint: "Pass a value for {input}, or omit it entirely.",
        },
      }),
    })({
      description:
        "Minimum password length for the project's password policy, for example 12; 0 sets none. Without it, setup sets 15, the NIST minimum for password-only sign-in; change it in .zitadel/policies/ later.",
    }),
    [SETUP_FLAG_KEYS.provider]: Flags.string({
      description:
        "Social sign-in provider to enable while scaffolding, e.g. google. Skips the wizard's provider question; needs --sso-client-id, and the OAuth application must already be registered with the provider. Pipe the client secret in on stdin; never pass it as a flag.",
      options: [...IDP_PROVIDERS, CUSTOM_PROVIDER],
    }),
    "sso-client-id": Flags.custom<ClientId>({
      parse: parses(parseClientId, {
        refusal: {
          message: "{input}: {problem}",
          hint: "Fix {input} and run the command again.",
          details: {
            argument: "{input}",
          },
        },
      }),
    })({
      description: "Client id of the OAuth application registered with the --sso provider.",
    }),
    [SETUP_FLAG_KEYS.slug]: Flags.custom<string>({
      parse: accepts((value) => {
        return parseConnectionSlug(value, RESERVED_SLUGS);
      }),
    })({
      description: "With --sso custom: the name of the connection. Schemas and flows refer to it.",
    }),
    [SETUP_FLAG_KEYS.displayName]: Flags.custom<string>({
      parse: accepts(parseDisplayName),
    })({
      description: "With --sso custom: the name shown on the sign-in button.",
    }),
    [SETUP_FLAG_KEYS.issuer]: Flags.custom<string>({
      parse: accepts(parseIssuer),
    })({
      description:
        "With --sso custom: the provider's issuer URL. Its endpoints come from OIDC discovery.",
    }),
    [SETUP_FLAG_KEYS.scopes]: Flags.custom<string>({
      parse: accepts(parseScopes),
    })({
      description:
        "With --sso custom: the scopes to request, separated by spaces or commas. Must include openid. Default: openid profile email.",
    }),
  };

  /**
   * That setup resolves its own server, in the preconditions.
   */
  static override meta = {
    resolveServer: false,
  };

  /**
   * The server a recovery names instead of the env file, for a project setup
   * moved to another port that has no env file to pin.
   */
  private recoveryServer: string | undefined;

  /**
   * What every command setup suggests is pinned to: the env file setup wrote,
   * so a follow-up reaches the project setup created and not one the shell's
   * environment names, and `--cwd` as typed, so it works from wherever it is
   * run (`--env-file` is read from the shell's directory, so the file is named
   * under `--cwd`). A command that resolves no environment takes only the
   * directory.
   *
   * @returns The scope.
   */
  protected override scope(): Scope {
    const { cwd } = super.scope();

    return {
      ...(cwd === undefined ? {} : { cwd }),
      ...(this.recoveryServer === undefined
        ? { envFile: projectEnvFile(cwd, RECOVERY_ENV_FILE) }
        : { server: this.recoveryServer }),
    };
  }

  /**
   * Refuses a command line setup cannot act on, then runs the steps of `setup`
   * in the order they run: end early for an app that is already set up, work out
   * what the run is about and what to write, create the app and the project,
   * patch and configure them, and finish with the credentials, the install, the
   * commit and the first deploy.
   *
   * @remarks
   * The steps are built when this runs, not when the file loads, so a step may
   * import what it needs from this file. Every step that may ask the person
   * takes the same services, held once as `prompting`.
   *
   * @param admitted - What the command admitted.
   * @param admitted.flags - The flags.
   * @returns The envelope the run answers with.
   */
  protected async execute({ flags }: Admitted<typeof Setup>): Promise<JsonEnvelope> {
    refuseUnusableFlags(flags, this.nonInteractive);

    const prompting = {
      ask: this.ask,
      cwd: this.cwd,
      dryRun: this.dryRun,
      nonInteractive: this.nonInteractive,
      serverFlag: this.meta.serverFlag,
      suggest: this.suggest,
      ui: this.ui,
    };

    return this.emit(
      await Wizard.named<Fact<"flags">, CommandResult>("setup")
        .step(
          new CheckPreconditions({
            meta: this.meta,
            suggest: this.suggest,
            useServer: (server) => {
              this.meta = {
                ...this.meta,
                source: server,
              };
            },
          }),
        )
        .endWhen(
          new MoveAppPort({
            cliVersion: this.cliVersion,
            consent: (gate) => {
              return this.consent(gate);
            },
            cwd: this.cwd,
            dryRun: this.dryRun,
            realRun: () => {
              return this.realRun();
            },
            recoverAt: (server) => {
              this.recoveryServer = server;
            },
            signal: this.signal,
            suggest: this.suggest,
            ui: this.ui,
          }),
        )
        .endWhen(
          new ReportAlreadySetUp({
            dryRun: this.dryRun,
          }),
        )
        .step(
          new ReadSsoFlags({
            ask: this.ask,
            dryRun: this.dryRun,
            nonInteractive: this.nonInteractive,
            suggest: this.suggest,
          }),
        )
        .step(
          new DetectFramework({
            ask: this.ask,
            cwd: this.cwd,
            env: this.env,
            force: this.force,
            nonInteractive: this.nonInteractive,
            serverFlag: this.meta.serverFlag,
            ui: this.ui,
          }),
          ({ flags, found, scaffoldedFramework }) => {
            this.recordTelemetry({
              framework: found.app.framework,
              renderer: flags.renderer ?? "react",
              scaffolded_skeleton: scaffoldedFramework,
              skip_install: Boolean(flags.skipInstall),
              dev_port_explicit: flags.devPort !== undefined,
              preset: flags.preset ?? DEFAULT_SETUP_PRESET,
              use_case: flags.useCase ?? DEFAULT_SETUP_USE_CASE,
              sso: flags.sso ?? "none",
              password_policy: flags.passwordMinLength === null ? "empty" : "set",
              step: "framework_resolved",
            });
          },
        )
        .step(new ApplyDefaults())
        .step(new ConfirmFramework(prompting))
        .step(new ChooseServer(prompting))
        .step(new ChooseDevPort(prompting))
        .step(new ChooseUseCase(prompting))
        .step(new ChooseSignIn(prompting))
        .step(new SetPasswordPolicy(prompting))
        .step(new ChooseSocialSignIn(prompting))
        .step(
          new SettleAnswers({
            dryRun: this.dryRun,
            nonInteractive: this.nonInteractive,
            suggest: this.suggest,
          }),
          ({ answers }) => {
            this.recordTelemetry({
              preset: answers.preset,
              use_case: answers.useCase,
              sso:
                answers.sso.length > 1
                  ? "multiple"
                  : (answers.sso.map((draft) => {
                      return selectionName(draft.selection);
                    })[0] ?? "none"),
              password_policy: answers.passwordMinLength === null ? "empty" : "set",
            });
          },
        )
        .step(
          new PlanConfiguration({
            cliVersion: this.cliVersion,
            cwd: this.cwd,
            force: this.force,
          }),
        )
        .step(
          new ScaffoldApp({
            cwd: this.cwd,
            dryRun: this.dryRun,
            env: this.env,
            force: this.force,
            ui: this.ui,
          }),
        )
        .step(
          new CheckPatch({
            cwd: this.cwd,
            dryRun: this.dryRun,
            force: this.force,
          }),
        )
        .step(
          new CreateProject({
            cwd: this.cwd,
            dryRun: this.dryRun,
            signal: this.signal,
            suggest: this.suggest,
            ui: this.ui,
          }),
          () => {
            this.recordTelemetry({ step: "project_created" });
          },
        )
        .step(
          new PatchApp({
            cwd: this.cwd,
            dryRun: this.dryRun,
            force: this.force,
            ui: this.ui,
          }),
        )
        .step(
          new WriteConfiguration({
            cliVersion: this.cliVersion,
            cwd: this.cwd,
            dryRun: this.dryRun,
            force: this.force,
            serverFlag: this.meta.serverFlag,
            signal: this.signal,
            suggest: this.suggest,
          }),
        )
        .step(
          new KeepChanges({
            cwd: this.cwd,
            dryRun: this.dryRun,
          }),
          ({ allFilesWritten, scaffolded }) => {
            this.recordTelemetry({
              step: "files_patched",
              files_written_count: allFilesWritten.length,
            });
            if (!this.dryRun) {
              this.recordTelemetry({
                password_policy: scaffolded.passwordMinLength === null ? "empty" : "set",
              });
            }
          },
        )
        .commit()
        .step(
          new PublishCredentials({
            dryRun: this.dryRun,
            signal: this.signal,
            suggest: this.suggest,
          }),
        )
        .step(
          new WriteManifest({
            cwd: this.cwd,
            dryRun: this.dryRun,
          }),
        )
        .step(
          new InstallDependencies({
            cwd: this.cwd,
            dryRun: this.dryRun,
            env: this.env,
            isJson: this.isJson,
            signal: this.signal,
            suggest: this.suggest,
            ui: this.ui,
          }),
          ({ installOutcome }) => {
            this.recordTelemetry({
              step: "dependencies_installed",
              package_manager: installOutcome.install.package_manager,
            });
          },
        )
        .step(
          new MakeInitialCommit({
            cwd: this.cwd,
            dryRun: this.dryRun,
            ui: this.ui,
          }),
        )
        .step(
          new DoInitialDeploy({
            cwd: this.cwd,
            dryRun: this.dryRun,
            env: this.env,
            isColored: this.isColored,
            isJson: this.isJson,
            narrate: (notices) => {
              this.narrate(notices);
            },
            signal: this.signal,
            suggest: this.suggest,
            ui: this.ui,
          }),
        )
        .step(
          new ClaimOwnership({
            cwd: this.cwd,
            dryRun: this.dryRun,
            signal: this.signal,
            suggest: this.suggest,
            ui: this.ui,
          }),
        )
        .step(
          new ShowResult({
            cliVersion: this.cliVersion,
            cwd: this.cwd,
            dryRun: this.dryRun,
            isJson: this.isJson,
            realRun: () => {
              return this.realRun();
            },
            suggest: this.suggest,
            ui: this.ui,
          }),
        )
        .finish((state) => {
          return state.answer;
        })
        .run(
          { flags },
          {
            signal: this.signal,
            onUndoError: (key, error) => {
              reportWarning(`Could not take back the ${key} step: ${errorMessage(error)}`);
            },
          },
        ),
    );
  }
}
