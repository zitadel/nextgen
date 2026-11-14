import { errorMessage, ZitadelError } from "@/lib/errors";
import {
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
} from "@zitadel/config/defaults";
import {
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  providerOf,
  selectionName,
  DEFAULT_SCOPES,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  RESERVED_SLUGS,
  slugFromDisplayName,
} from "@zitadel/config/idp";
import {
  customFlagValues,
  SETUP_FLAG_KEYS,
  SETUP_FLAG_NAMES,
  selectionFromFlags,
  ssoEnableFlags,
} from "@/lib/idp";
import type { Suggest, SuggestedCommand, SuggestFlags } from "@/lib/suggestion";
import { tryCatch } from "@/lib/try-catch";
import type { GlobalOptions } from "@/lib/oclif/types";
import type { ResolvedServer } from "@/lib/server";

import type {
  ProviderSelection,
  ConnectionEndpoints,
  ConnectionSlug,
  Credentials,
} from "@zitadel/config/idp";
import {
  ConnectionExistsError,
  DiskStore,
  FileExistsError,
  PasswordPolicy,
  type Scaffold,
  type ScaffoldedConnection,
  SignupPolicy,
  ZitadelConfig,
  type PasswordMinLength,
  type ScaffoldedProvider,
  TOGGLEABLE_METHODS,
  type ToggleableMethod,
  CONFIG_DIRECTORIES,
} from "@/lib/zitadel";

import type { CustomFlagValues, PublishState, SecretOutcome } from "@/lib/idp";
import type { Questions, Step, Ui, Spinner } from "@/lib/ui";

import type { SetupPreset, SetupUseCase } from "@zitadel/config/defaults";

import type { CreatedProject } from "@/lib/backend";
import type { InitialDeployment } from "@/lib/environment";
import type { FrameworkFacts, Orca, UndoableScaffold, FrameworkChoice } from "@/lib/orca";
import type { derivePosture } from "@/lib/orca/patchers/posture";
import type { PatchContext, PatchResult } from "@/lib/orca/patchers/types";

import type { SetupFlags } from "@/cli/commands/setup";

import type { Consent, Gate } from "@/lib/consent";
import type { CommandResult } from "@/lib/oclif";

import { path as stylePath } from "@/lib/style";

import { META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";
import { escapeControlCharacters } from "@/lib/terminal-text";
import type { InitialCommitOutcome } from "@/cli/commands/setup/steps/make-initial-commit";
import type { installDependenciesForSetup } from "@/cli/commands/setup/steps/install-dependencies";
import type { ChooseDevPort } from "./steps/choose-dev-port";
import type { ConfirmFramework } from "./steps/confirm-framework";
import type { SetPasswordPolicy } from "./steps/set-password-policy";
import type { ChooseServer } from "./steps/choose-server";
import type { ChooseSignIn } from "./steps/choose-sign-in";
import type { ChooseSocialSignIn } from "./steps/choose-social-sign-in";
import type { ChooseUseCase } from "./steps/choose-use-case";

import { Repository } from "@/lib/git";
import { isLocalRuntimePath } from "@/lib/secret-paths";

/**
 * The name of the README setup writes into each configuration directory.
 */
export const README = "README.md";

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
  ".env.development.local": { subject: "the environment variables the CLI reads" },
  ".zitadel/state.json": { subject: "the scaffold state file" },
  [DEFAULT_FLOW_CONFIG_PATH]: { subject: "the editable default login flow" },
  [`${CONFIG_DIRECTORIES.flows}/${README}`]: { subject: "the flows folder README" },
  [DEFAULT_SCHEMA_CONFIG_PATH]: { subject: "the editable default human user schema" },
  [`${CONFIG_DIRECTORIES.schemas}/${README}`]: { subject: "the schemas folder README" },
  [PasswordPolicy.PATH]: { subject: "the editable password policy" },
  [SignupPolicy.PATH]: { subject: "the editable sign-up policy" },
  [`${CONFIG_DIRECTORIES.policies}/${README}`]: { subject: "the policies folder README" },
  [`${META_SCHEMA_DIR}/policy.json`]: { subject: "the policy dialect spec (editor $schema)" },
  [`${META_SCHEMA_DIR}/flow-definition.json`]: {
    subject: "the flow dialect spec (editor $schema)",
  },
  [`${META_SCHEMA_DIR}/user-schema.json`]: { subject: "the user-schema dialect spec" },
  [`${META_SCHEMA_DIR}/user-property.json`]: { subject: "the user-property dialect spec" },
  [`${META_SCHEMA_DIR}/branding.json`]: { subject: "the branding dialect spec" },
  [`${META_SCHEMA_DIR}/project.json`]: { subject: "the zitadel.json spec (editor $schema)" },
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

/**
 * A social provider chosen during setup, with whatever of its application's
 * credentials is known so far.
 *
 * Flags seed a draft and the wizard completes it, so until then either
 * credential may be missing. {@link SsoAnswer} is a draft that has both, and
 * everything that publishes a credential takes that type: choosing a provider
 * and then withholding one scaffolds a sign-in button that cannot work, and it
 * should not be possible to write the code that lets it happen.
 */
export type SsoDraft = {
  readonly selection: ProviderSelection;
  readonly credentials: Partial<Credentials>;
  /**
   * Where the connection points, when not at the vendor. Asked for only on a
   * development run (ZITADEL_CLI_DEV), whose one job is standing the provider
   * up locally — see {@link ChooseSocialSignIn}.
   */
  readonly endpoints?: ConnectionEndpoints;
};

/**
 * A provider with both credentials. Both are required: the connection document
 * stores `${{ NAME }}` references, and the engine resolves them from the
 * project's variables, so a missing value fails at the provider with
 * `invalid_client` long after setup reported success. Declining the provider is
 * the answer for "not now" — `auth-method sso enable` adds it once the OAuth
 * application exists.
 *
 * Neither value is ever written to a `.zitadel/` file.
 */
export type SsoAnswer = SsoDraft & { readonly credentials: Credentials };

/**
 * What the person, the flags and the defaults decided, which the steps after the
 * questions read and the patcher turns into the generated `zitadel.json`.
 */
export type SetupAnswers = {
  server: string;
  devPort: number;
  /** Sign-in preset (flow + auth methods); see `SETUP_PRESETS` in @zitadel/config. */
  preset: SetupPreset;
  /** Use case (schema field set); see `SETUP_USE_CASES` in @zitadel/config. */
  useCase: SetupUseCase;
  /**
   * Social providers to enable while scaffolding, empty for email sign-in
   * only. Chosen by {@link ChooseSocialSignIn};
   * `auth-method sso enable` adds one to an existing Project later, so this is
   * never the only way in.
   *
   * A list because a project may offer several at once, and the schema and
   * flow already carry `sso_providers` as a list of slugs — one answer per
   * provider, each with its own credentials.
   */
  sso: readonly SsoDraft[];
  /**
   * The minimum password length to put into the password policy setup
   * writes: a number, `null` for an explicit "none", or `undefined` when none
   * was given, which writes the recommended minimum (`PasswordPolicy.initial`).
   * Chosen by {@link SetPasswordPolicy} or
   * `--password-min-length`.
   */
  passwordMinLength?: PasswordMinLength;
};

/**
 * The app the questions are about: its framework and the port its dev server
 * starts on.
 */
type App = Readonly<{
  /**
   * The id of the framework.
   */
  framework: string;

  /**
   * The port its dev server starts on.
   */
  devPort: number;
}>;

/**
 * Everything a run of `setup` comes to know, by the name each fact is read by.
 *
 * @remarks
 * Each step adds some of these and reads some, naming the ones it reads with
 * {@link Fact}. The first two are what the run starts from.
 */
export type SetupFacts = Readonly<{
  /**
   * The flags the command admitted.
   */
  flags: SetupFlags;

  /**
   * What the run settled before the first step: the server, and whether the
   * directory is already set up.
   */
  preflight: SetupPreflight;

  /**
   * The provider the command line asked for, with what it said about it.
   */
  ssoFromCommandLine: SsoDraft | undefined;

  /**
   * Knows the frameworks and how to patch an app of each.
   */
  orca: Orca;

  /**
   * What detection found, before the answers can change the port.
   */
  found: Readonly<{
    app: App;
    detected: FrameworkFacts | undefined;
    scaffoldedBesideFiles: boolean;
  }>;

  /**
   * Whether the app is a new one the run creates, and not one the developer
   * brought.
   */
  scaffoldedFramework: boolean;

  /**
   * The app, with the port the run uses.
   */
  app: App;

  /**
   * What the person, the flags and the defaults decided.
   */
  answers: SetupAnswers;

  /**
   * The origin the app serves from, which the project registers.
   */
  issuer: string;

  /**
   * The renderer the widgets are drawn with.
   */
  rendererId: string;

  /**
   * How the widgets sit in the app.
   */
  posture: ReturnType<typeof derivePosture>;

  /**
   * Patches the app's files.
   */
  patcher: ReturnType<Orca["patcherFor"]>;

  /**
   * What the patcher needs to know about the app and the project.
   */
  patchContext: (framework: FrameworkFacts, project: CreatedProject) => PatchContext;

  /**
   * The configuration setup will write, planned and so already refused if it
   * would step on a file.
   */
  planned: Awaited<ReturnType<typeof scaffoldOf>>;

  /**
   * The new app, when the run creates one, which it can take back.
   */
  newApp: UndoableScaffold | undefined;

  /**
   * The app the patch works on, with the port the answers settled.
   */
  framework: FrameworkFacts | undefined;

  /**
   * The project just created.
   */
  project: CreatedProject;

  /**
   * What a retry has to carry to reproduce this run.
   */
  retry: SetupRetryOptions;

  /**
   * What patching the app's files did.
   */
  patched: PatchResult;

  /**
   * The credential files as they were before the patch merged into them.
   */
  envFilesBefore: ReadonlyMap<string, Buffer | undefined>;

  /**
   * The spinner patching the files, which the configuration's files are
   * reported under.
   */
  patching: Step | undefined;

  /**
   * The default configuration written under `.zitadel/`.
   */
  scaffolded: ScaffoldedConfiguration;

  /**
   * Every file written, as an absolute path.
   */
  allFilesWritten: readonly string[];

  /**
   * What sign-in and registration are configured to do.
   */
  signIn: SignIn;

  /**
   * What became of each provider's credentials, by slug.
   */
  ssoOutcomes: ReadonlyMap<
    ConnectionSlug,
    {
      clientId: PublishState;
      secret: SecretOutcome;
    }
  >;

  /**
   * What installing the dependencies did.
   */
  installOutcome: Awaited<ReturnType<typeof installDependenciesForSetup>>;

  /**
   * What committing the project did.
   */
  commit: InitialCommitOutcome;

  /**
   * What the first deploy published, or nothing when there was none.
   */
  deployment: InitialDeployment | undefined;

  /**
   * The local admin the project was attached to, when it was.
   */
  ownedByLocalAdmin:
    | Readonly<{
        email: string;
        team_id: string;
      }>
    | undefined;

  /**
   * Whether the local server hosts the platform plane.
   */
  hostsPlatform: boolean;

  /**
   * Whether the server is one the CLI started on this machine.
   */
  isLocal: boolean;
}>;

/**
 * The part of what is known that a step reads or adds, by name.
 *
 * @typeParam Key - The facts.
 */
export type Fact<Key extends keyof SetupFacts> = Pick<SetupFacts, Key>;

/**
 * What a run of `setup` starts from.
 */
export type SetupInput = Fact<"flags">;

/**
 * What the run answers: the command's envelope.
 */
export type SetupAnswer = CommandResult;

/**
 * What the command provides every step: the run's facts, and the parts of the
 * command that draw, write the configuration and word the result, which stay
 * in the command.
 */
export type SetupServices = Readonly<{
  /**
   * The command's global options, as the run was given them.
   */
  meta: GlobalOptions;

  /**
   * Pins the run to the server the preconditions settled, so the steps after
   * them read it as `source`.
   *
   * @param server - The server.
   */
  useServer(server: string): void;

  /**
   * The project's directory.
   */
  cwd: string;

  /**
   * The run's environment variables.
   */
  env: NodeJS.ProcessEnv;

  /**
   * The questions the run may ask a person.
   */
  ask: Questions;

  /**
   * Where the run draws.
   */
  ui: Ui;

  /**
   * Builds the commands the run suggests.
   */
  suggest: Suggest;

  /**
   * Stops the run when the person interrupts it.
   */
  signal: AbortSignal;

  /**
   * The version of the running CLI.
   */
  cliVersion: string;

  /**
   * Whether the run only previews.
   */
  dryRun: boolean;

  /**
   * Whether `--force` overwrites the files setup writes.
   */
  force: boolean;

  /**
   * Whether the run may not ask anything.
   */
  nonInteractive: boolean;

  /**
   * Whether the run answers with JSON.
   */
  isJson: boolean;

  /**
   * The server as the developer typed it, when they did.
   */
  serverFlag: string | undefined;

  /**
   * The server the run addresses.
   */
  source: string;

  /**
   * Whether the run draws in colour.
   */
  isColored: boolean;

  /**
   * Says what the run did, outside the result.
   *
   * @param notices - The lines to say.
   */
  narrate(notices: readonly string[]): void;

  /**
   * Asks for the consent a destructive step needs.
   *
   * @param gate - What is asked for.
   * @returns The consent, or nothing when the person declined.
   */
  consent: (gate: Gate) => Promise<Consent | undefined>;

  /**
   * The command that runs the same again for real.
   *
   * @returns The command.
   */
  realRun: () => Promise<SuggestedCommand>;

  /**
   * Pins the follow-up commands to a server, for a project that has no env file.
   *
   * @param server - The server to pin them to.
   */
  recoverAt: (server: string) => void;
}>;

/**
 * Read-only facts a question may need.
 */
export type PromptContext = {
  /**
   * How a prompt asks its question: the typed questions every other command
   * asks through, so every question the wizard asks behaves like every other
   * question the CLI asks. It cannot ask a destructive `confirm`, so
   * setup's `--force`, which means "overwrite files", never answers one of its
   * questions.
   */
  readonly ask: Questions;
  /**
   * Something the person must read or go and do outside the terminal, such as
   * registering an OAuth application, as the one boxed thing a prompt draws.
   * It goes through the UI package for the same reason `ask` does: a prompt
   * that drew its own box would draw one that matches nothing else.
   */
  readonly note: (title: string, lines: readonly string[]) => void;
  /**
   * One line in the chain that is not a question, such as what happens now
   * that a provider was skipped.
   */
  readonly say: (text: string) => void;
  /**
   * A spinner for a probe that takes long enough to need saying so, stopped or
   * cleared by the prompt that started it. It draws nothing when nobody is
   * watching, so a prompt never tests for a terminal.
   */
  readonly spinner: (label: string, options?: { guide?: boolean }) => Spinner;
  /**
   * The framework of the app setup integrates: its id and the name a question
   * shows ("Next.js"). Nothing more: a new app does not exist while the wizard
   * asks, because setup creates it once it has every answer.
   */
  readonly framework: FrameworkChoice;
  /**
   * A command for this app's project, for a question that names what to run
   * once setup is done, such as adding a skipped provider. It carries the
   * selector setup's own recovery commands carry, so it reaches the project
   * setup creates and not one the shell's environment names.
   */
  readonly suggest: Suggest;
  /**
   * The app directory setup runs in. {@link ChooseServer}
   * reads the local runtime metadata (`.zitadel/local/runtime.json`) under it
   * to detect a managed local server started here.
   */
  readonly cwd: string;
  /**
   * Whether the developer already named the framework: picked it to scaffold
   * an empty directory, or passed `--framework`. Then
   * {@link ConfirmFramework} has nothing
   * left to confirm and skips itself.
   */
  readonly frameworkChosen?: boolean;
  /**
   * The raw `--server` flag value as the user passed it, or `undefined`
   * when not provided. Prompts use this to skip themselves when the flag
   * already pinned the answer (a step returns unchanged answers in
   * that case). Distinct from
   * `answers.server`, which is *always* populated by the base command's
   * server-resolution chain — checking that alone can't distinguish "user
   * passed a flag" from "we fell back to the cloud default".
   */
  readonly serverFlag?: string;
  /**
   * Whether `--dev-port` was passed explicitly. When set, the flag is
   * authoritative and {@link ChooseDevPort} skips itself so
   * an interactive answer can't override a scripted/flagged port.
   */
  readonly devPortFromFlag?: boolean;
  /**
   * Whether `--preset` was passed explicitly. When set, the flag is
   * authoritative and {@link ChooseSignIn}
   * skips itself.
   */
  readonly presetFromFlag?: boolean;
  /**
   * Whether `--use-case` was passed explicitly. When set, the flag is
   * authoritative and {@link ChooseUseCase} skips itself.
   */
  readonly useCaseFromFlag?: boolean;
  /**
   * Whether `--sso` was passed explicitly. When set, the flag answers the
   * provider question and {@link ChooseSocialSignIn}
   * does not ask it.
   *
   * The credential questions are a separate matter: the prompt still asks for
   * a client id or secret the invocation did not supply, because a connection
   * missing either is one that cannot work. Only a `--non-interactive` run has
   * nobody to ask, and that one is refused rather than left incomplete.
   */
  readonly ssoFromFlag?: boolean;
  /**
   * Whether `--password-min-length` was passed explicitly. When set, the flag
   * is authoritative and {@link SetPasswordPolicy}
   * skips itself.
   */
  readonly passwordMinLengthFromFlag?: boolean;
  /**
   * Whether this is a development run (the ZITADEL_CLI_DEV opt-in). Only a
   * development run asks where a provider's endpoints are — see
   * {@link ChooseSocialSignIn}. Passed in rather
   * than read from the bundle so a test can drive both answers.
   */
  readonly developmentBuild?: boolean;
};

/**
 * The parts of a setup invocation that a retry suggestion must reproduce.
 * Suggested retries are followed verbatim (especially by agents), so dropping
 * a flag here silently changes what the retry scaffolds.
 */
export type SetupRetryOptions = {
  /**
   * The framework as `--framework` named it.
   */
  framework?: string;

  /**
   * The sign-in preset.
   */
  preset?: SetupPreset;

  /**
   * The use case.
   */
  useCase?: SetupUseCase;

  /**
   * The renderer.
   */
  renderer?: string;

  /**
   * The dev-server port.
   */
  devPort?: number;

  /**
   * The `--sso` flags as typed, when they could not be resolved to a provider
   * yet: a custom connection described in part, which the wizard completes.
   * Dropping them would send the developer back without what they typed.
   */
  ssoTyped?: SsoFlags;
  /**
   * The social provider and its client id. The secret is deliberately absent:
   * a retry asks for it again, or takes it on stdin, because putting a
   * credential in suggested command text is exactly what piping the secret
   * exists to avoid. It never reaches the filesystem either way — the value
   * goes to the project's variables, which is where the engine resolves the
   * connection's `${{ NAME }}` from.
   */
  sso?: readonly ProviderSelection[];
  /**
   * The minimum password length the run was given: a number, or `null` for
   * an explicit "none", carried as `--password-min-length 0` so a kept policy
   * file still loses its minimum on the retry.
   */
  passwordMinLength?: PasswordMinLength;
  /**
   * The server as the developer typed it. Left out, a retry pins the local
   * server; `null` leaves it to the default, as a run that typed none did.
   */
  server?: string | null;
};

/**
 * What setup's default configuration left behind.
 */
export type ScaffoldedConfiguration = {
  /**
   * The absolute paths of the files written.
   */
  filesWritten: string[];

  /**
   * The minimum password length the password policy holds. A kept policy file
   * decides that as much as the answers do: one without `min_length` keeps
   * none when none was given. `null` when it has none.
   */
  passwordMinLength: number | null;
};

/**
 * The default configuration setup scaffolds into a project, planned against
 * the files the project already has.
 *
 * @remarks
 * Every file it would refuse is refused here, so setup calls it before it
 * creates the project: those files are written only once the project exists,
 * and a conflict found then would leave the project behind. The files are
 * read without being held to their contracts: a default schema, flow or
 * password policy that is broken stands in the way like a valid one, so it is
 * replaced with `force` and refused without it, and a broken file setup does
 * not write is left for the deploy to refuse.
 *
 * The configuration is read without refusing a broken file: the scaffold knows
 * which paths it would write, so it alone decides whether a broken default is
 * replaced (`force`) or refused, and any other broken file is left to the
 * deploy. Only the kinds it scaffolds or plans around are read: branding is
 * never written, so an unreadable branding file does not stand in setup's way.
 *
 * @param cwd - The project root.
 * @param force - Whether the default schema and flow may be replaced, and an
 *   existing password or sign-up policy kept.
 * @param answers - What to scaffold.
 * @param signupPolicy - Whether a project without a sign-up policy gets the
 *   default one; false for a server that does not take the policy yet.
 * @returns The configuration, and the change that writes it.
 * @throws {@link ZitadelError} With `E_CONFLICT` for the first file setup
 *   would refuse to write, or `E_VALIDATION` for a kept password or sign-up
 *   policy that is not valid.
 */
export async function scaffoldOf(
  cwd: string,
  force: boolean,
  answers: Pick<SetupAnswers, "preset" | "useCase" | "sso" | "passwordMinLength">,
  signupPolicy = true,
): Promise<Scaffold<SsoDraft>> {
  try {
    return (
      await ZitadelConfig.loadKinds(new DiskStore(cwd), [
        "schemas",
        "flows",
        "connections",
        "policies",
      ])
    ).scaffold({
      preset: answers.preset,
      useCase: answers.useCase,
      sso: answers.sso,
      passwordMinLength: answers.passwordMinLength,
      signupPolicy,
      force,
    });
  } catch (error) {
    throw setupRefusal(error, []);
  }
}

/**
 * The refusal setup words for a file it will not write, with what to do about
 * that file; any other error as it is.
 *
 * @remarks
 * A connection is never replaced, so its refusal names the command that
 * enables the provider with the connection that is there. Setup stopped
 * before it created a project, so there is no environment to carry: the
 * command is for after the developer reruns setup.
 *
 * @param error - What the configuration library threw.
 * @param connections - The connections setup planned, for a connection file
 *   a write found taken.
 * @returns The error to throw.
 */
export function setupRefusal(
  error: unknown,
  connections: readonly ScaffoldedConnection[],
): unknown {
  if (error instanceof ConnectionExistsError) {
    return connectionRefusal(error.path, error.selection);
  }
  if (!(error instanceof FileExistsError)) {
    return error;
  }
  const planned = connections.find((scaffolded) => {
    return scaffolded.connection.path === error.path;
  });
  if (planned !== undefined) {
    return connectionRefusal(error.path, planned.chosen.selection);
  }
  if (error.path === PasswordPolicy.PATH) {
    return new ZitadelError("E_CONFLICT", error.message, {
      hint: "Rerun setup with --force to keep this policy and deploy it to the new project, or move the file aside to start from an empty one.",
      details: error.details,
    });
  }
  if (error.path === SignupPolicy.PATH) {
    return new ZitadelError("E_CONFLICT", error.message, {
      hint: "Rerun setup with --force to keep this policy and deploy it to the new project, or move the file aside to start from the default.",
      details: error.details,
    });
  }
  return new ZitadelError("E_CONFLICT", error.message, {
    hint: "Move the file aside or rerun setup with --force if you want setup to replace it.",
    details: error.details,
  });
}

/**
 * The refusal for a provider whose connection file is already there.
 *
 * @remarks
 * Setup neither replaces nor removes one, with or without `--force`: the
 * developer decides what happens to the file.
 *
 * @param path - The project-relative path of the connection.
 * @param selection - The provider, as it was chosen.
 * @returns The `E_CONFLICT` error, with the command that enables the provider
 *   afterwards.
 */
function connectionRefusal(path: string, selection: ProviderSelection): ZitadelError {
  return new ZitadelError("E_CONFLICT", `${path} already exists`, {
    hint:
      "A connection file is yours to keep, so setup never replaces or removes one. " +
      "Remove it and run setup again to scaffold a fresh one, or keep it and enable the " +
      "provider afterwards to reuse it.",
    nextCommands: [
      {
        id: "auth-method:sso:enable",
        flags: ssoEnableFlags(selection),
      },
    ],
    details: {
      file: path,
    },
  });
}

/**
 * The settings of a custom connection, asking only for the ones not already
 * given — the way `--preset` skips its own question and no other.
 *
 * @remarks
 * A given value goes through the same parser as a typed one, so every setting
 * comes back checked against the contract the server enforces on apply, and a
 * name or issuer it would refuse is refused. The command line's own mistakes
 * are named under their flag before this runs (`checkGivenCustomFlags`), so a
 * given value that gets here has already passed.
 *
 * The display name comes first so the slug can be suggested from it: "Acme SSO"
 * offers "acme-sso", which the developer accepts or edits. The settings carry
 * the scopes as the one string a flag does.
 *
 * @param given - The settings the command line already gave.
 * @param ask - The questions the run may ask a person.
 * @returns Every setting, given or answered.
 */
export async function askCustomSettings(
  given: CustomFlagValues,
  ask: Questions,
): Promise<Required<CustomFlagValues>> {
  const displayName = await ask.text({
    name: "display name",
    message: "What name should the sign-in button show? For example Acme SSO.",
    parse: parseDisplayName,
    given: given.displayName,
  });
  const slug = await ask.text({
    name: "connection name",
    message:
      "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
    parse: (value) => {
      return parseConnectionSlug(value, RESERVED_SLUGS);
    },
    given: given.slug,
    initialValue: slugFromDisplayName(displayName, RESERVED_SLUGS),
  });
  const issuer = await ask.text({
    name: "issuer",
    message: "What is the issuer URL of the provider?",
    parse: parseIssuer,
    given: given.issuer,
  });
  const scopes = await ask.text({
    name: "scopes",
    message: "Which scopes should we request? Separate them with spaces.",
    parse: parseScopes,
    given: given.scopes,
    initialValue: DEFAULT_SCOPES.join(" "),
  });
  return {
    slug,
    displayName,
    issuer,
    scopes: scopes.join(" "),
  };
}

/**
 * Renders a path under `cwd` with stable POSIX separators.
 *
 * @remarks
 * Setup's summary matches generated artifacts against repository-style
 * suffixes such as `.zitadel/schemas/default-human-user.json`; normalizing here
 * keeps those matches working when Node returns Windows paths with
 * backslashes.
 *
 * @param cwd - The project directory.
 * @param absolute - The path to render.
 * @returns The path relative to `cwd` when it is inside it, with `/`
 *   separators.
 */
export function relativeDisplayPath(cwd: string, absolute: string): string {
  const boundary = absolute[cwd.length];
  const withinCwd = absolute.startsWith(cwd) && (boundary === "/" || boundary === "\\");
  const display = withinCwd ? absolute.slice(cwd.length + 1) : absolute;
  return display.replaceAll("\\", "/");
}

/**
 * The sign-in configuration setup's answers add up to, as `data.sign_in`
 * reports it. Read off the schema setup renders rather than inferred from the
 * preset's name: `password-first` enables passkeys too, and a use case's
 * profile fields are optional. It describes what is configured, not that
 * sign-in works: an enabled method is not a credential a user has registered.
 */
export type SignIn = {
  /**
   * The method the login flow's entry step offers.
   */
  starts_with: "password" | "passkey";

  /**
   * The methods the user schema enables: the one sign-in starts with, the
   * other, then `sso` when a provider is on.
   */
  methods: string[];

  /**
   * What registration asks for, in order, and whether each is required.
   */
  fields: {
    name: string;
    required: boolean;
  }[];

  /**
   * `null` when passwords have no minimum length.
   */
  password_min_length: number | null;

  /**
   * The external providers' slugs, in the order they were chosen.
   */
  providers: string[];
};

/**
 * The sign-in configuration setup's answers add up to, read off the
 * configuration setup scaffolds for them.
 *
 * @remarks
 * Scaffolded on an empty configuration, so a password policy `--force` keeps
 * is not read: the caller reports the minimum it wrote in its place. The schema
 * is the one setup writes: the preset and use case's template with each chosen
 * provider enabled, so `methods` names `sso` when it is on.
 *
 * @param answers - The preset, use case, providers and minimum password
 *   length setup was given.
 * @returns What sign-in and registration are configured to do.
 */
export function signInOf(answers: {
  preset: SetupPreset;
  useCase: SetupUseCase;
  sso: readonly ScaffoldedProvider[];
  passwordMinLength?: PasswordMinLength;
}): SignIn {
  const { schema, policy } = ZitadelConfig.empty().scaffold({
    preset: answers.preset,
    useCase: answers.useCase,
    sso: answers.sso,
    passwordMinLength: answers.passwordMinLength,
    force: false,
  });
  const startsWith: ToggleableMethod = answers.preset === "passkey-first" ? "passkey" : "password";
  const required: readonly string[] = schema.requiredPaths;
  return {
    starts_with: startsWith,
    methods: [
      ...[
        startsWith,
        ...TOGGLEABLE_METHODS.filter((method) => {
          return method !== startsWith;
        }),
      ].filter((method) => {
        return schema.enabledMethods[method];
      }),
      ...(schema.isSsoEnabled ? ["sso"] : []),
    ],
    fields: schema.propertyNames.map((name) => {
      return {
        name,
        required: required.includes(name),
      };
    }),
    password_min_length: policy.minLength ?? null,
    providers: [...schema.providers],
  };
}

/**
 * Picks one written file by suffix so the corresponding INSTALLED row can
 * reference it without hard-coding the path the patcher chose.
 *
 * @remarks
 * Returns the first match; falls back to `undefined` when the patcher didn't
 * write that artifact (e.g. a renderer without a register page).
 *
 * @param written - The files written.
 * @param suffix - The ending of the path to find.
 * @returns The first file that ends in `suffix`, or nothing.
 */
export function pickWrittenFile(written: string[], suffix: string): string | undefined {
  return written.find((file) => {
    return file.endsWith(suffix);
  });
}

/**
 * Translates a patcher-written path into a single sentence the user can read
 * at narration speed.
 *
 * @remarks
 * The patch result's `filesWritten` carries deduplicated file paths only
 * (directories stay in the typed `files` rows), so no artefact filtering is
 * needed here. The verb tense flips for `--dry-run` so the user sees a preview
 * ("Would write ...") instead of a claim that something happened.
 *
 * @param relPath - The path of the file, relative to the project.
 * @param dryRun - Whether the run only previews.
 * @returns The sentence.
 */
export function describeWrittenFile(relPath: string, dryRun: boolean): string | null {
  const verb = dryRun ? "Would write" : "Wrote";
  const sentence = SENTENCE_BY_PATH[relPath];
  if (sentence) {
    return `${verb} ${sentence.subject} (${stylePath(escapeControlCharacters(relPath))})`;
  }
  return `${verb} ${stylePath(escapeControlCharacters(relPath))}`;
}

/**
 * Whether the CLI writes a path itself, so it does not count as the
 * developer's uncommitted work.
 *
 * @remarks
 * Matched against a path already made relative to the project directory, never
 * the repository root: in a monorepo the two differ, and comparing the wrong
 * one refuses every subdirectory project.
 *
 * Just the two `start` leaves behind: the `.zitadel/local/` it writes and the
 * `.gitignore` line that ignores it. It runs immediately before `setup` on the
 * documented golden path, so counting those would refuse every project that
 * has ever been started. Nothing else under `.zitadel/` is exempt: a
 * connection in `.zitadel/idps/` or a policy file is the developer's, and an
 * uncommitted edit there must not be committed under setup's subject.
 *
 * @param path - The path, relative to the project directory.
 * @returns Whether the CLI writes it.
 */
function isCliOwned(path: string): boolean {
  return path === ".gitignore" || path.endsWith("/.gitignore") || isLocalRuntimePath(path);
}

/**
 * What the git working tree of a project holds, as setup needs to know before
 * it writes.
 */
export type WorktreeState =
  | {
      readonly kind: "no-repository";
    }
  | {
      readonly kind: "unknown";
      readonly reason: string;
    }
  | {
      readonly kind: "blocked";
      readonly blocked: string;
    }
  | {
      readonly kind: "dirty";
      readonly modified: readonly string[];
      readonly untracked: readonly string[];
    }
  | {
      readonly kind: "clean";
    };

/**
 * Reports what the repository of a project holds, before setup writes a single
 * file.
 *
 * @remarks
 * Setup commits what it wrote so the first release records a real commit, and
 * the honest way to know what it wrote is that the tree was clean beforehand:
 * then everything uncommitted afterwards is setup's own work and nothing of
 * the developer's is swept in. A dirty tree makes that impossible to tell
 * apart, and committing someone's work-in-progress under setup's name is worse
 * than any diff it would buy. Asked up front rather than at commit time, so
 * a refusal costs nothing and leaves no half-made project behind.
 *
 * A repository where a commit would land where it should not (during a
 * merge, rebase, cherry-pick, revert or bisect, or on a detached HEAD) is
 * `blocked` for the same reason: found only at commit time, setup would
 * already have done all its work.
 *
 * When git cannot answer, the state is `unknown`: the commit does not check
 * again, so going ahead would stage and commit the very work this guard exists
 * to protect.
 *
 * @param cwd - The project directory.
 * @returns What the working tree holds.
 */
export async function inspectWorktree(cwd: string): Promise<WorktreeState> {
  const repository = await Repository.open(cwd);
  if (repository === null) {
    return {
      kind: "no-repository",
    };
  }
  try {
    const blocked = await repository.readyToCommit();
    if (blocked !== null) {
      return {
        kind: "blocked",
        blocked,
      };
    }
    const dirty = (await repository.uncommittedFiles()).filter((file) => {
      return !isCliOwned(file.path);
    });
    if (dirty.length === 0) {
      return {
        kind: "clean",
      };
    }
    return {
      kind: "dirty",
      modified: dirty
        .filter((change) => {
          return !change.untracked;
        })
        .map((change) => {
          return change.path;
        }),
      untracked: dirty
        .filter((change) => {
          return change.untracked;
        })
        .map((change) => {
          return change.path;
        }),
    };
  } catch (error) {
    return {
      kind: "unknown",
      reason: errorMessage(error),
    };
  }
}

/**
 * What setup needs to know about the run before it detects or writes anything.
 */
export type SetupPreflight = Readonly<{
  /**
   * The server the run addresses.
   */
  server: ResolvedServer;

  /**
   * Whether the directory is already set up.
   */
  configured: boolean;
}>;

/**
 * The `--sso-*` flags that describe a custom connection, as `setup` takes them.
 * A setting that was not given is `undefined`, which a suggestion leaves out.
 */
type SsoSettingFlags = Readonly<{
  /**
   * The name of the connection.
   */
  ssoSlug?: string;

  /**
   * The name shown on the sign-in button.
   */
  ssoDisplayName?: string;

  /**
   * The provider's issuer URL.
   */
  ssoIssuer?: string;

  /**
   * The scopes to request.
   */
  ssoScopes?: string;
}>;

/**
 * `--sso` and the settings that go with it, as typed.
 */
type SsoFlags = SsoSettingFlags & Readonly<{ sso: string }>;

/**
 * Whether `--sso` names a provider this CLI offers.
 *
 * @param name - What `--sso` was given.
 * @returns Whether it is a provider in the catalogue, or a custom connection.
 */
function isKnownSsoName(name: string): boolean {
  return name === CUSTOM_PROVIDER || (IDP_PROVIDERS as readonly string[]).includes(name);
}

/**
 * The `--sso-*` flags for the settings that were given.
 *
 * @param values - The custom connection's settings, each perhaps missing.
 * @returns The flags, in the order the command line takes them.
 */
function ssoSettingFlags(values: CustomFlagValues): SsoSettingFlags {
  return {
    ssoSlug: values.slug,
    ssoDisplayName: values.displayName,
    ssoIssuer: values.issuer,
    ssoScopes: values.scopes,
  };
}

/**
 * The flags of the current invocation for retry guidance, ending in
 * `--server local` unless the run named a server.
 *
 * @remarks
 * Flags whose resolved value equals the default are omitted: the retry
 * reproduces the same outcome without them, and a value left `undefined` is
 * left out of the command. The directory is not among them: the run puts its
 * own `--cwd` on every command it suggests. The password minimum is carried
 * even when it is the recommended one, unlike the defaults: without the flag, a
 * policy file `--force` keeps keeps its own minimum.
 *
 * Only the first provider is carried: `--sso` takes one, and a scripted rerun
 * can pipe only one secret. A retry naming several would not be runnable, which
 * is the whole point of this line. The rest are not silently dropped: the
 * guidance that uses this emits an `auth-method sso enable` command for each,
 * because `--sso` makes the rerun skip the multi-select, so a provider left out
 * here could not be reselected.
 *
 * The provider only, never `--sso-client-id`: it would interpolate a value the
 * wizard accepted on emptiness alone into a command run verbatim, and the rerun
 * asks for the id. A custom connection is nothing without its description, and
 * none of it is a credential, so unlike the client id it travels in the
 * command.
 *
 * @param opts - What the invocation was given and resolved.
 * @returns The flags of the `setup` that repeats it, in command-line order.
 */
export function setupRetryFlags(opts: SetupRetryOptions): SuggestFlags<"setup"> {
  const [firstSso] = opts.sso ?? [];
  return {
    framework: opts.framework || undefined,
    preset: opts.preset === DEFAULT_SETUP_PRESET ? undefined : opts.preset,
    useCase: opts.useCase === DEFAULT_SETUP_USE_CASE ? undefined : opts.useCase,
    renderer: opts.renderer === "react" ? undefined : opts.renderer,
    devPort: opts.devPort,
    passwordMinLength: opts.passwordMinLength === null ? 0 : opts.passwordMinLength,
    ...(firstSso === undefined
      ? opts.ssoTyped
      : {
          sso: selectionName(firstSso),
          ...(firstSso.kind === "custom"
            ? ssoSettingFlags({
                slug: firstSso.connection.slug,
                displayName: firstSso.connection.displayName,
                issuer: firstSso.connection.issuer,
                scopes: firstSso.connection.scopes.join(" "),
              })
            : {}),
        }),
    server: opts.server === null ? undefined : (opts.server ?? "local"),
  };
}

/**
 * Retry options straight from parsed flags, for failures before the wizard
 * resolves answers.
 *
 * @remarks
 * How the run answered (`--non-interactive`) is not carried: a suggested
 * command never says it, and it re-infers itself on the retry.
 *
 * The provider survives on its own. A suggested retry carries `--sso` without
 * `--sso-client-id` -- the id is never put in command text -- so requiring both
 * here would drop the provider from the next suggestion if that retry failed
 * again before the wizard ran, and the developer would be told to set up
 * without the provider they asked for. An empty id means "ask for it", which is
 * what the wizard does with it.
 *
 * A custom connection is restated as typed, minus the credentials. One the
 * checks refuse is left out: it was refused, and a retry carrying it would be
 * refused again. What was typed for a provider this run knows is kept when it
 * cannot become a selection yet, so a retry reproduces it.
 *
 * @param flags - The flags the invocation was given.
 * @returns The options a retry has to carry.
 */
export function retryOptionsFromFlags(flags: {
  framework?: string;
  preset?: string;
  useCase?: string;
  renderer?: string;
  devPort?: number;
  passwordMinLength?: PasswordMinLength;
  sso?: string;
  ssoClientId?: string;
  ssoSlug?: string;
  ssoDisplayName?: string;
  ssoIssuer?: string;
  ssoScopes?: string;
}): SetupRetryOptions {
  const [, selection] = tryCatch(() => {
    if (flags.sso === undefined) {
      return undefined;
    }
    return selectionFromFlags(
      flags.sso,
      customFlagValues(flags, SETUP_FLAG_KEYS),
      SETUP_FLAG_NAMES,
      "",
    );
  });
  return {
    ssoTyped:
      selection === undefined && flags.sso !== undefined && isKnownSsoName(flags.sso)
        ? {
            sso: flags.sso,
            ...ssoSettingFlags(customFlagValues(flags, SETUP_FLAG_KEYS)),
          }
        : undefined,
    framework: flags.framework,
    preset: flags.preset as SetupPreset | undefined,
    useCase: flags.useCase as SetupUseCase | undefined,
    renderer: flags.renderer,
    devPort: flags.devPort,
    passwordMinLength: flags.passwordMinLength,
    sso: selection === undefined ? undefined : [selection],
  };
}

/**
 * How to finish what a rerun will not. Setup configures one provider, so a run
 * that chose several needs the rest enabled afterwards: this is the hint
 * saying so and an `auth-method sso enable` for each one left.
 *
 * @remarks
 * `--sso` names one provider and makes the rerun skip the multi-select, so
 * every other provider chosen would be lost unless it is restored explicitly.
 * Both recovery paths need this -- the one before the wizard and the one for a
 * failed project creation.
 *
 * The client id is not given. These commands are run verbatim, especially by
 * agents: `auth-method sso enable` asks for the id, exactly as it asks for the
 * secret, which is never put in command text for the same reason.
 *
 * `--server local` is given too, as the setup retry pins it. An unpinned
 * `auth-method sso enable` takes its server from `ZITADEL_URL`, so with that
 * variable set to another server it would publish the client id and secret
 * there -- leaving the local provider unconfigured and the credentials
 * somewhere nobody asked for. Both callers of this are local-server failures,
 * so `local` is the server meant in every case. The run's scope pins the
 * project and credential (`--env-file .env.development.local`, which outranks
 * the process environment, unlike `--env`), so `--server local` alone cannot
 * send a production token to the local server.
 *
 * @param retry - What the run was given and resolved.
 * @param suggest - Renders a suggestion for the run that reports it, which
 *   pins the project setup creates (`--env-file`) as every recovery does.
 * @returns The hint, and the commands that enable the providers left.
 */
export function ssoRecovery(
  retry: SetupRetryOptions,
  suggest: Suggest,
): { hint: string; commands: SuggestedCommand[] } {
  const [first, ...remaining] = retry.sso ?? [];
  if (remaining.length === 0) {
    return {
      hint: "",
      commands: [],
    };
  }
  return {
    hint:
      `The rerun configures ${first ? providerOf(first).slug : ""} only; add the rest with the auth-method sso enable ` +
      "commands below, which ask for each client id. ",
    commands: remaining.map((selection) => {
      return suggest({
        id: "auth-method:sso:enable",
        flags: {
          ...ssoEnableFlags(selection),
          server: "local",
        },
      });
    }),
  };
}
