import type {
  SetupAnswer,
  SetupAnswers,
  SetupFacts,
  SetupInput,
  SetupServices,
} from "@/cli/commands/setup/shared";
import {
  whole,
  type Declaration,
  filled,
  type ParseRefusal,
  type ReadAlone,
  type Refused,
  reads,
} from "@/lib/oclif/flags";
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
  type Parsed,
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

import { customExample, SETUP_FLAG_KEYS, SETUP_FLAG_NAMES } from "@/lib/idp";
import { type Admitted, BaseCommand, CommandGroups, nonBlankString } from "@/lib/oclif";
import { Destructive } from "@/lib/oclif/destructive";
import { projectEnvFile } from "@/lib/oclif/environment-flags";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import { createOrca } from "@/lib/orca";
import {
  AVAILABLE_RENDERER_IDS,
  RENDERER_IDS,
} from "@/lib/orca/patchers/rule/next/renderers/registry";
import type { Scope } from "@/lib/suggestion";
import { PAGE_LAYOUT_HINT, PasswordPolicy } from "@/lib/zitadel";

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

import { CheckPreconditions } from "@/cli/commands/setup/steps/check-preconditions";
import type { PasswordMinLength } from "@/lib/zitadel";

import type { JsonEnvelope } from "@/lib/oclif";

/** The `--sso-*` flags that describe a custom connection, and whether one is needed. */
const CUSTOM_SETTINGS = [
  {
    name: "ssoSlug",
    flag: "--sso-slug",
    needed: true,
  },
  {
    name: "ssoDisplayName",
    flag: "--sso-display-name",
    needed: true,
  },
  {
    name: "ssoIssuer",
    flag: "--sso-issuer",
    needed: true,
  },
  {
    name: "ssoScopes",
    flag: "--sso-scopes",
    needed: false,
  },
] as const;

const DESIGN_REMOVED_REFUSAL = {
  message: "setup no longer applies a login template, so --design was removed",
  hint: `Rerun setup without --design. ${PAGE_LAYOUT_HINT} To own the widget's structure after setup, eject one of: ${BRANDING_DESIGNS.join(", ")}.`,
  next: [{ id: "branding:eject" }],
} as const satisfies Refusal;

const CLIENT_ID_NEEDS_SSO_REFUSAL = {
  message: "--sso-client-id needs --sso",
  hint: "Name the provider with --sso, e.g. --sso google.",
} as const satisfies Refusal;

const SETTING_NEEDS_SSO_REFUSAL = {
  message: `{flag} needs --sso ${CUSTOM_PROVIDER}`,
  hint: `Name the provider with --sso ${CUSTOM_PROVIDER}.`,
} as const satisfies Refusal;

const SETTINGS_NEED_CUSTOM_REFUSAL = {
  message: "{names} only applies to a custom connection",
  hint: `Add --sso ${CUSTOM_PROVIDER}, or remove {them}.`,
  details: {
    flags: "{flags}",
  },
} as const satisfies Refusal;

const CUSTOM_CONNECTION_INCOMPLETE_REFUSAL = {
  message: "A custom connection needs {list}",
  hint: `Describe the connection, e.g. ${customExample(SETUP_FLAG_NAMES)}`,
  details: {
    missing: "{missing}",
  },
} as const satisfies Refusal;

const SSO_NEEDS_CLIENT_ID_REFUSAL = {
  message: "--sso {sso} needs --sso-client-id",
  hint: "Register {registration} and pass its client id.",
} as const satisfies Refusal;

/**
 * How a setting that holds nothing is refused: what to do about an empty value
 * is to pass one or leave the flag out, which is not what to do about a value
 * the provider would reject, so the two are worded apart.
 */
const EMPTY_SETTING = {
  message: "the value is empty",
  hint: "Pass a value for {input}, or omit it entirely.",
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

/** The flags {@link refuseUnusableFlags} reads, as a command reads them. */
export type SetupFlagsToCheck = Readonly<{
  design?: string;
  sso?: string;
  ssoClientId?: string;
  ssoSlug?: string;
  ssoDisplayName?: string;
  ssoIssuer?: string;
  ssoScopes?: string;
}>;

/** Where an application for `provider` is registered, for the hint to name. */
function whereToRegister(flags: SetupFlagsToCheck, provider: string): string {
  const entry = provider === CUSTOM_PROVIDER ? undefined : parseProviderSelection(provider);
  const catalog = entry === undefined ? undefined : providerOf(entry);
  if (catalog?.consoleUrl !== undefined) {
    return `an OAuth application at ${catalog.consoleUrl}`;
  }
  return `a client at ${catalog?.issuer ?? String(flags.ssoIssuer)}`;
}

/**
 * Refuses a command line setup cannot act on, before anything is detected,
 * created or written: a removed flag, and a set of `--sso` flags that
 * contradict each other or leaves out what nobody can be asked for. `scripted`
 * says nobody can be asked; a person at a terminal is asked for what is
 * missing instead.
 */
export function refuseUnusableFlags(flags: SetupFlagsToCheck, scripted: boolean): void {
  if (flags.design !== undefined) {
    throw refusalError(DESIGN_REMOVED_REFUSAL, {});
  }
  if (flags.ssoClientId !== undefined && flags.sso === undefined) {
    throw refusalError(CLIENT_ID_NEEDS_SSO_REFUSAL, {});
  }
  if (flags.sso === undefined) {
    const orphan = CUSTOM_SETTINGS.find((setting) => {
      return flags[setting.name] !== undefined;
    });
    if (orphan !== undefined) {
      throw refusalError(SETTING_NEEDS_SSO_REFUSAL, {
        flag: orphan.flag,
      });
    }
    return;
  }
  if (flags.sso !== CUSTOM_PROVIDER) {
    const given = CUSTOM_SETTINGS.filter((setting) => {
      return flags[setting.name] !== undefined;
    });
    if (given.length > 0) {
      throw refusalError(SETTINGS_NEED_CUSTOM_REFUSAL, {
        names: given
          .map((setting) => {
            return setting.flag;
          })
          .join(", "),
        them: new Intl.PluralRules("en").select(given.length) === "one" ? "it" : "them",
        flags: given.map((setting) => {
          return setting.flag;
        }),
      });
    }
  }
  if (!scripted) {
    return;
  }
  if (flags.sso === CUSTOM_PROVIDER) {
    const missing = CUSTOM_SETTINGS.filter((setting) => {
      return setting.needed && flags[setting.name] === undefined;
    }).map((setting) => {
      return setting.flag;
    });
    if (missing.length > 0) {
      throw refusalError(CUSTOM_CONNECTION_INCOMPLETE_REFUSAL, {
        list: missing.join(", "),
        missing,
      });
    }
  }
  if (flags.ssoClientId === undefined) {
    throw refusalError(SSO_NEEDS_CLIENT_ID_REFUSAL, {
      sso: flags.sso,
      registration: whereToRegister(flags, flags.sso),
    });
  }
}

/**
 * A trimmed value one of the platform's own parsers accepts, kept as it was
 * typed. The parser's `problem` becomes the schema's message, so a flag and the
 * prompt that asks the same thing cannot word a refusal differently.
 */
function accepted(parse: (value: string) => Parsed<unknown>) {
  return filled.transform((value, ctx) => {
    const parsed = parse(value);
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message: parsed.problem,
      });
      return z.NEVER;
    }
    return value;
  });
}

/** What one of those parsers makes of a trimmed value. See {@link accepted}. */
function made<T>(parse: (value: string) => Parsed<T>) {
  return filled.transform((value, ctx) => {
    const parsed = parse(value);
    if (!parsed.ok) {
      ctx.addIssue({
        code: "custom",
        message: parsed.problem,
      });
      return z.NEVER;
    }
    return parsed.value;
  });
}

/**
 * The `parse` of a flag that refuses an empty value as any flag does, and
 * everything else as `refused` words it. It takes the declaration as
 * {@link reads} does, so the wording is checked where the flag is declared.
 *
 * @typeParam T - What the value parses to.
 * @typeParam R - The declaration's refusal, as it is written.
 * @typeParam Declared - The declaration, as it is written.
 * @typeParam Empty - The refusal for an empty value, as it is written. It
 *   has no `values`, so it may ask only for what the parse fills
 *   ({@link ReadAlone}).
 * @param refused - What a value that is not empty is refused for.
 * @param empty - What an empty value is refused with; {@link EMPTY_SETTING}
 *   when it is left out.
 * @returns The `parse`.
 */
function readsFilled<
  T,
  const R extends ParseRefusal,
  const Declared extends Refused<T>,
  const Empty extends ParseRefusal = typeof EMPTY_SETTING,
>(refused: Declaration<T, R, Declared>, empty?: Empty & ReadAlone<Empty>) {
  const emptied: ParseRefusal = empty ?? EMPTY_SETTING;
  const blank = reads({
    schema: filled,
    refusal: emptied,
  });
  const declared: Refused<T> = refused;
  const value = reads(declared);
  return async (given: string, command: unknown, definition: { name: string }): Promise<T> => {
    await blank(given, command, definition);
    return value(given, command, definition);
  };
}

/**
 * A custom connection's setting, refused with what the platform's own parser
 * found wrong with it.
 */
function settingFlag(flag: string, parse: (value: string) => Parsed<unknown>) {
  return Flags.custom<string>({
    parse: readsFilled({
      schema: accepted(parse),
      refusal: {
        message: `${flag}: {problem}`,
        hint: `Fix ${flag} and run the command again.`,
        details: {
          flag,
        },
      },
    }),
  });
}

/**
 * The flags the command admitted, which every step reads what it needs from.
 */
export type SetupFlags = Admitted<typeof Setup>["flags"];

/**
 * `zitadel setup` — create a Zitadel project and scaffold local auth.
 *
 * Runs as a wizard of steps (see `wizard()`): detect the app, ask what the
 * flags left open, create the project, patch the app and write the editable
 * `.zitadel/**` configuration, then publish credentials, install, commit and
 * deploy. An interactive setup ends with a note about the Zitadel agent skills,
 * shown once per machine; set `NO_SKILLS_PROMPT=1` to hide it.
 */
export default class Setup extends Destructive(BaseCommand) {
  static override description =
    "Create a Zitadel project and scaffold local auth. An interactive setup ends with a note about the Zitadel agent skills, shown once per machine; set NO_SKILLS_PROMPT=1 to hide it.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 1;
  static override heading = "Setting up Zitadel";
  static override wizard = true;

  static override examples = [
    "<%= config.bin %> setup --framework next",
    "<%= config.bin %> setup --framework react --dev-port 3000",
  ];
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
    // Hidden so scripts and agents passing it get a targeted error pointing
    // at `branding eject` instead of oclif's unknown-flag error.
    design: nonBlankString({ hidden: true }),
    "password-min-length": Flags.custom<PasswordMinLength>({
      parse: readsFilled(
        {
          schema: made(PasswordPolicy.parseMinLength),
          refusal: {
            message: "{problem}",
            hint: "Pass a whole number for {input}, or 0 for none.",
            details: {
              argument: "{input}",
            },
          },
        },
        {
          message: "{input} was given an empty value",
          hint: "Pass a value for {input}, or omit it entirely.",
        },
      ),
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
      parse: readsFilled({
        schema: made(parseClientId),
        refusal: {
          message: "--sso-client-id: {problem}",
          hint: "Fix --sso-client-id and run the command again.",
          details: {
            argument: "--sso-client-id",
          },
        },
      }),
    })({
      description: "Client id of the OAuth application registered with the --sso provider.",
    }),
    [SETUP_FLAG_KEYS.slug]: settingFlag("--sso-slug", (value) => {
      return parseConnectionSlug(value, RESERVED_SLUGS);
    })({
      description: "With --sso custom: the name of the connection. Schemas and flows refer to it.",
    }),
    [SETUP_FLAG_KEYS.displayName]: settingFlag(
      "--sso-display-name",
      parseDisplayName,
    )({
      description: "With --sso custom: the name shown on the sign-in button.",
    }),
    [SETUP_FLAG_KEYS.issuer]: settingFlag(
      "--sso-issuer",
      parseIssuer,
    )({
      description:
        "With --sso custom: the provider's issuer URL. Its endpoints come from OIDC discovery.",
    }),
    [SETUP_FLAG_KEYS.scopes]: settingFlag(
      "--sso-scopes",
      parseScopes,
    )({
      description:
        "With --sso custom: the scopes to request, separated by spaces or commas. Must include openid. Default: openid profile email.",
    }),
  };

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

  protected async execute({ flags }: Admitted<typeof Setup>): Promise<JsonEnvelope> {
    refuseUnusableFlags(flags, this.nonInteractive);

    return this.wizard().run(
      this.services(),
      { flags },
      {
        signal: this.signal,
        onUndoError: (key, error) => {
          reportWarning(`Could not take back the ${key} step: ${errorMessage(error)}`);
        },
      },
    );
  }

  /**
   * The steps of `setup`, in the order they run: end early for an app that is
   * already set up, work out what the run is about and what to write, create
   * the app and the project, patch and configure them, and finish with the
   * credentials, the install, the commit and the first deploy.
   *
   * @remarks
   * Built when it runs, not when the file loads, so a step may import what it
   * needs from this file.
   *
   * @returns The wizard, ready to run.
   */
  private wizard() {
    return Wizard.named<SetupServices, SetupInput, SetupAnswer>("setup")
      .step(new CheckPreconditions())
      .endWhen(new MoveAppPort())
      .endWhen(new ReportAlreadySetUp())
      .step(new ReadSsoFlags())
      .step(new DetectFramework())
      .step(new ApplyDefaults())
      .step(new ConfirmFramework())
      .step(new ChooseServer())
      .step(new ChooseDevPort())
      .step(new ChooseUseCase())
      .step(new ChooseSignIn())
      .step(new SetPasswordPolicy())
      .step(new ChooseSocialSignIn())
      .step(new SettleAnswers())
      .step(new PlanConfiguration())
      .step(new ScaffoldApp())
      .step(new CheckPatch())
      .step(new CreateProject())
      .step(new PatchApp())
      .step(new WriteConfiguration())
      .step(new KeepChanges())
      .commit()
      .step(new PublishCredentials())
      .step(new WriteManifest())
      .step(new InstallDependencies())
      .step(new MakeInitialCommit())
      .step(new DoInitialDeploy())
      .step(new ClaimOwnership())
      .step(new ShowResult())
      .finish((state) => {
        return state.answer;
      });
  }

  /**
   * What every step is given: the run's facts, and the parts of this command
   * that write the configuration, draw and answer.
   *
   * @returns The services.
   */
  private services(): SetupServices {
    const meta = () => {
      return this.meta;
    };
    return {
      meta: this.meta,
      useServer: (server) => {
        this.meta = {
          ...this.meta,
          source: server,
        };
      },
      cwd: this.cwd,
      env: this.env,
      ask: this.ask,
      ui: this.ui,
      suggest: this.suggest,
      signal: this.signal,
      cliVersion: this.cliVersion,
      dryRun: this.dryRun,
      force: this.force,
      nonInteractive: this.nonInteractive,
      isJson: this.isJson,
      consent: (gate) => {
        return this.consent(gate);
      },
      emit: (result) => {
        return this.emit(result);
      },
      realRun: () => {
        return this.realRun();
      },
      recoverAt: (server) => {
        this.recoveryServer = server;
      },
      isColored: this.isColored,
      narrate: (notices) => {
        this.narrate(notices);
      },
      serverFlag: this.meta.serverFlag,
      get source() {
        return meta().source;
      },
      frameworkResolved: (input) => {
        this.frameworkResolved(input);
      },
      answersSettled: (answers) => {
        this.answersSettled(answers);
      },
      projectCreated: () => {
        this.recordTelemetry({ step: "project_created" });
      },
      filesPatched: (count, passwordMinLength) => {
        this.filesPatched(count, passwordMinLength);
      },
      dependenciesInstalled: (packageManager) => {
        this.recordTelemetry({
          step: "dependencies_installed",
          package_manager: packageManager,
        });
      },
    };
  }

  /**
   * Record which framework the run settled on, and how it was asked for.
   *
   * @param input - The flags, what detection found, and whether the app is new.
   */
  private frameworkResolved(
    input: Pick<SetupFacts, "flags" | "found" | "scaffoldedFramework">,
  ): void {
    const { flags, found, scaffoldedFramework } = input;
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
  }

  /**
   * Record what the answers settled.
   *
   * @remarks
   * The interactive prompts can override the flag or default preset and use case
   * recorded at `framework_resolved`, so they are recorded again: telemetry
   * carries the values that actually scaffold. One slug, "none", or "multiple",
   * never a joined set: a dimension's value space has to stay enumerable.
   *
   * @param answers - What was decided.
   */
  private answersSettled(answers: SetupAnswers): void {
    const ssoDimension =
      answers.sso.length > 1
        ? "multiple"
        : answers.sso[0]
          ? selectionName(answers.sso[0].selection)
          : "none";
    this.recordTelemetry({
      preset: answers.preset,
      use_case: answers.useCase,
      sso: ssoDimension,
      // Whether a minimum goes into the password policy, never the value. None
      // given is the recommended one (`PasswordPolicy.initial`), unless `--force`
      // keeps a policy file: `files_patched` records what was published.
      password_policy: answers.passwordMinLength === null ? "empty" : "set",
    });
  }

  /**
   * Record how many files were written, and what was published for the password
   * policy.
   *
   * @param count - The files written.
   * @param passwordMinLength - The minimum the published policy holds.
   */
  private filesPatched(
    count: number,
    passwordMinLength: SetupFacts["scaffolded"]["passwordMinLength"],
  ): void {
    this.recordTelemetry({
      step: "files_patched",
      files_written_count: count,
    });
    if (!this.dryRun) {
      // What was actually published, which a policy file `--force` keeps decides
      // as much as the answers recorded before. A dry run publishes nothing and
      // keeps those.
      this.recordTelemetry({
        password_policy: passwordMinLength === null ? "empty" : "set",
      });
    }
  }
}
