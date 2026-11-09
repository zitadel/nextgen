import {
  type CreatedProject,
  InvalidError,
  PolicyService,
  ProjectService,
  VariableService,
  VariableWrite,
  createZitadelClient,
} from "@/lib/backend";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { intro, note, outro } from "@clack/prompts";
import { Flags } from "@oclif/core";
import { z } from "zod";
import {
  BRANDING_DESIGNS,
  DEFAULT_FLOW_CONFIG_PATH,
  DEFAULT_SCHEMA_CONFIG_PATH,
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  flowsReadmeContent,
  policiesReadmeContent,
  schemasReadmeContent,
  SETUP_PRESETS,
  SETUP_USE_CASES,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import { META_SCHEMA_DIR } from "@zitadel/config/meta-schemas";
import {
  type ClientId,
  type ConnectionSlug,
  credentialVariables,
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  type Parsed,
  parseProviderSelection,
  parseScopes,
  providerOf,
  type ProviderSelection,
  RESERVED_SLUGS,
  selectionName,
} from "@zitadel/config/idp";
import { consola } from "consola";
import { isDevelopmentBuild } from "@/lib/build-channel";
import { BOX_STYLE, renderBoxActions, wrapForBox } from "@/lib/box";
import {
  claimAction,
  claimBoxAction,
  claimCommand,
  claimState,
  claimWindowDeadline,
} from "@/lib/claim-state";
import { errorMessage, isErrno, toZitadelError, ZitadelError } from "@/lib/errors";
import {
  callbackUriFor,
  customExample,
  customFlagText,
  type CustomFlagValues,
  flagText,
  loopbackIssuerWarning,
  publishClientId,
  type PublishState,
  reportClientIdOutcome,
  reportSecretOutcome,
  republishCommands,
  type SecretOutcome,
  type SecretPublisher,
  selectionFromFlags,
  SETUP_FLAG_KEYS,
  SETUP_FLAG_NAMES,
  ssoEnableArgs,
  storeClientSecret,
} from "@/lib/idp";
import { brandingGuidanceAction, exploreAllCommands } from "@/lib/journey-guidance";
import {
  type Admitted,
  BaseCommand,
  CommandGroups,
  type JsonEnvelope,
  nonBlankString,
} from "@/lib/oclif";
import { environmentSelectorSuffix, projectEnvFile } from "@/lib/oclif/environment-flags";
import { serverKind } from "@/lib/oclif/server-kind";
import { findLocalAdminFor } from "@/lib/local-server/admin-credential";
import { claimProjectAsAdmin } from "@/lib/local-server/claim-as-admin";
import { LocalServer } from "@/lib/local-server/server";
import { readNearestRuntimeMetadata, readPlatformRuntime } from "@/lib/local-server/runtime";
import {
  hasZitadelConfig,
  hasZitadelSecret,
  readProjectServer,
  readZitadelConfig,
  readZitadelSecret,
  writeZitadelSecret,
} from "@/lib/project";
import {
  createOrca,
  type FrameworkFacts,
  inspectScaffoldTarget,
  isDirectoryOrMissing,
  issuerFromPort,
  type Orca,
  type ScaffoldTarget,
  type UndoableScaffold,
} from "@/lib/orca";
import {
  AVAILABLE_RENDERER_IDS,
  RENDERER_IDS,
} from "@/lib/orca/patchers/rule/next/renderers/registry";
import type { PatchContext } from "@/lib/orca/patchers/types";
import type { Asker } from "@/lib/input";
import { Connection, type PasswordMinLength, PasswordPolicy, SignupPolicy } from "@/lib/zitadel";
import { derivePosture } from "@/lib/orca/patchers/posture";
import { writeScaffoldManifest } from "@/lib/scaffold-manifest";
import { normalizePublicCliProse } from "@/lib/public-cli";
import {
  CONFIG_DIRECTORIES,
  ConnectionExistsError,
  DiskStore,
  FileExistsError,
  PAGE_LAYOUT_HINT,
  type Scaffold,
  type ScaffoldedConnection,
  ZitadelConfig,
} from "@/lib/zitadel";
import { DEPLOY_ARGS } from "@/lib/suggestion";
import { deployInitialRelease, type InitialDeployment } from "@/lib/environment";
import { installDependenciesForSetup } from "./install";
import {
  ensureInitialCommit,
  gitReport,
  type InitialCommitOutcome,
  inspectWorktree,
  unavailableWarning,
  type WorktreeState,
} from "./initial-commit";
import { moveDevPort } from "./move-dev-port";
import {
  askCustomSettings,
  completeSso,
  PickFrameworkPrompt,
  SETUP_PROMPTS,
  type SetupAnswers,
  type SsoDraft,
} from "./prompts";
import {
  detectProjectFacts,
  fileNameOf,
  formatFrameworkLine,
  relativeDisplayPath as relativeDisplay,
  renderSummary,
  type SignIn,
  signInOf,
  signInSummary,
  type Row,
  type Section,
} from "./summary";
import { Cmd } from "@/lib/cmd";
import { id as styleId, path as stylePath, url as styleUrl } from "@/lib/style";
import { showSkillsHint } from "@/lib/skills-hint";
import { reportWarning } from "@/lib/warnings";
import {
  type EnvironmentSelector,
  inShell,
  projectCommand,
  type SuggestedCommand,
  unscopedCommand,
} from "@/lib/suggestion";
import { asStepsShown, type StepsShown } from "@/lib/oclif/next-steps";
import { Destructive } from "@/lib/oclif/destructive";
import semver from "semver";
import { type Refusal, refusalError } from "@/lib/oclif/refusal";
import type { GlobalOptions } from "@/lib/oclif/types";
import { type ResolvedServer, resolveServer } from "@/lib/server";
import { filled, type Refused, reads, whole } from "@/lib/oclif/flags";
import { userAgent } from "@/lib/user-agent";
import { escapeControlCharacters } from "@/lib/terminal-text";
import { prose } from "@/lib/oclif/rendering";

/**
 * {@link recoverySelector} plus `--server local`, for the recovery after a
 * local-server failure (see `ssoRecovery`).
 */
export function localRecoverySelector(cwd: string | undefined): EnvironmentSelector {
  return environmentSelectorSuffix({
    envFile: projectEnvFile(cwd, ".env.development.local"),
    server: "local",
    cwd,
  });
}

/**
 * The parts of a setup invocation that a retry suggestion must reproduce.
 * Suggested retries are followed verbatim (especially by agents), so dropping
 * a flag here silently changes what the retry scaffolds.
 */
export type SetupRetryOptions = {
  /**
   * The directory setup was pointed at, as typed. Every suggested rerun
   * carries it as `--cwd`, quoted for a shell, so it configures that project
   * from wherever it is run.
   */
  cwd?: string;
  framework?: string;
  preset?: SetupPreset;
  useCase?: SetupUseCase;
  renderer?: string;
  devPort?: number;
  nonInteractive?: boolean;
  /**
   * The `--sso` flags as typed, when they could not be resolved to a provider
   * yet: a custom connection described in part, which the wizard completes.
   * Dropping them would send the developer back without what they typed.
   */
  ssoTyped?: string;
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
};

/**
 * Reconstructs the flag list of the current invocation for retry guidance,
 * ending in `--server local`. Flags whose resolved value equals the default
 * are omitted — the retry reproduces the same outcome without them.
 */
export function setupRetryFlags(opts: SetupRetryOptions): string {
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
  if (opts.renderer && opts.renderer !== "react") {
    parts.push(`--renderer ${opts.renderer}`);
  }
  if (opts.devPort !== undefined) {
    parts.push(`--dev-port ${opts.devPort}`);
  }
  // Even the recommended one, unlike the defaults above: without the flag, a
  // policy file `--force` keeps keeps its own minimum.
  if (opts.passwordMinLength !== undefined) {
    parts.push(`--password-min-length ${opts.passwordMinLength ?? 0}`);
  }
  // Only the first: `--sso` takes one provider, and a scripted rerun can pipe
  // only one secret. A retry naming several would not be runnable, which is
  // the whole point of this line. The rest are not silently dropped -- the
  // guidance that uses this emits an `auth-method sso enable` command for each, because
  // `--sso` makes the rerun skip the multi-select, so a provider left out here
  // could not be reselected.
  const [firstSso] = opts.sso ?? [];
  if (firstSso === undefined && opts.ssoTyped !== undefined) {
    parts.push(opts.ssoTyped);
  }
  if (firstSso) {
    // Provider only. `--sso-client-id` would interpolate a value the wizard
    // accepted on emptiness alone into a command run verbatim, and nothing
    // here escapes it for a shell. The rerun asks for the id.
    parts.push(`--sso ${selectionName(firstSso)}`);
    // A custom connection is nothing without its description, and none of it is
    // a credential, so unlike the client id it travels in the command.
    if (firstSso.kind === "custom") {
      parts.push(customFlagText(firstSso.connection, SETUP_FLAG_NAMES));
    }
  }
  // `--non-interactive` is dropped when a provider is being configured: that
  // combination reads the client secret from stdin, and a command handed over
  // as text has no stdin to read. Offering it would advertise a retry that
  // fails the moment it is run. Interactively the rerun asks for the secret,
  // which is the one way a plain command can obtain it -- putting it in the
  // command text is never an option.
  if (opts.nonInteractive && firstSso === undefined && opts.ssoTyped === undefined) {
    parts.push("--non-interactive");
  }
  parts.push("--server local");
  return `${parts.join(" ")}${cwdArg(opts)}`;
}

/** Whether `--sso` names a provider this CLI offers. */
const isKnownSsoName = (name: string): boolean =>
  name === CUSTOM_PROVIDER || (IDP_PROVIDERS as readonly string[]).includes(name);

/**
 * Retry options straight from parsed flags, for failures before the wizard
 * resolves answers. `--non-interactive` is echoed only when explicitly passed
 * — TTY/JSON-inferred non-interactivity re-infers itself on the retry.
 */
export function retryOptionsFromFlags(flags: {
  cwd?: string;
  framework?: string;
  preset?: string;
  useCase?: string;
  renderer?: string;
  devPort?: number;
  nonInteractive?: boolean;
  passwordMinLength?: PasswordMinLength;
  sso?: string;
  ssoClientId?: string;
  ssoSlug?: string;
  ssoDisplayName?: string;
  ssoIssuer?: string;
  ssoScopes?: string;
}): SetupRetryOptions {
  // The provider survives on its own. A suggested retry carries `--sso`
  // without `--sso-client-id` -- the id is never put in command text -- so
  // requiring both here would drop the provider from the next suggestion if
  // that retry failed again before the wizard ran, and the developer would be
  // told to set up without the provider they asked for. An empty id means "ask
  // for it", which is what the wizard does with it.
  //
  // A custom connection is restated as typed, minus the credentials. One the
  // checks refuse is left out: it was refused, and a retry carrying it would be
  // refused again.
  let selection: ProviderSelection | undefined;
  if (flags.sso !== undefined) {
    try {
      selection = selectionFromFlags(flags.sso, customSettingsOf(flags), SETUP_FLAG_NAMES, "");
    } catch {
      selection = undefined;
    }
  }
  // What was typed for a provider this run knows, kept when it cannot become a
  // selection yet, so a retry reproduces it.
  const typed =
    selection === undefined && flags.sso !== undefined && isKnownSsoName(flags.sso)
      ? [`--sso ${flags.sso}`, flagText(customSettingsOf(flags), SETUP_FLAG_NAMES)]
          .filter((part) => part !== "")
          .join(" ")
      : undefined;
  return {
    ssoTyped: typed,
    framework: flags.framework,
    preset: flags.preset as SetupPreset | undefined,
    useCase: flags.useCase as SetupUseCase | undefined,
    cwd: flags.cwd,
    renderer: flags.renderer,
    devPort: flags.devPort,
    nonInteractive: Boolean(flags.nonInteractive),
    passwordMinLength: flags.passwordMinLength,
    // The provider survives on its own. A suggested retry carries `--sso`
    // without `--sso-client-id` -- the id is never put in command text -- so
    // requiring both here would drop the provider from the next suggestion if
    // that retry failed again before the wizard ran, and the developer would
    // be told to set up without the provider they asked for. An empty id
    // means "ask for it", which is what the wizard does with it.
    sso: selection === undefined ? undefined : [selection],
  };
}

/**
 * The providers a setup retry cannot carry, and how to restore them.
 *
 * `--sso` names one provider and makes the rerun skip the multi-select, so
 * every other provider chosen would be lost unless it is restored explicitly.
 * Both recovery paths need this -- the one before the wizard and the one for a
 * failed project creation -- and the second was missed when this was written
 * inline, which is exactly the kind of thing one copy prevents.
 */
/** `--cwd` for a suggested command, when setup was pointed at a directory. */
export function cwdArg(retry: SetupRetryOptions): string {
  return retry.cwd === undefined ? "" : ` ${Cmd.option("--cwd", retry.cwd)}`;
}

/**
 * How to finish what a rerun will not. Setup configures one provider, so a run
 * that chose several needs the rest enabled afterwards: this is the hint
 * saying so and an `auth-method sso enable` for each one left.
 */
export function ssoRecovery(
  retry: SetupRetryOptions,
  cliVersion: string,
): { hint: string; commands: SuggestedCommand[] } {
  const chosen = retry.sso ?? [];
  const remaining = chosen.slice(1);
  if (remaining.length === 0) {
    return { hint: "", commands: [] };
  }
  return {
    hint:
      `The rerun configures ${chosen[0] ? providerOf(chosen[0]).slug : ""} only; add the rest with the auth-method sso enable ` +
      "commands below, which ask for each client id. ",
    // The client id is not interpolated into the command. These strings are
    // run verbatim, especially by agents, and nothing escapes them for a
    // shell: a value the wizard accepted -- it only refuses an empty one --
    // could split into two arguments or carry a metacharacter that changes
    // what the command does. `auth-method sso enable` asks for the id, exactly as it asks
    // for the secret, which was never put in command text for the same
    // reason.
    // localRecoverySelector carries `--server local`, as the setup retry
    // pins it. An unpinned `auth-method sso enable`
    // takes its server from `ZITADEL_URL`, so with that variable set to
    // another server it would publish the client id and secret there --
    // leaving the local provider unconfigured and the credentials somewhere
    // nobody asked for. Both callers of this are local-server failures, so
    // `local` is the server meant in every case.
    //
    // `--env-file .env.development.local` pins the project and credential too:
    // `auth-method sso enable` is an EnvironmentCommand that resolves those from the
    // environment, where the process environment outranks the `.env` files, so
    // in a shell holding production values `--server local` alone would send
    // the production token to the local server. `--env-file` outranks the
    // process environment (unlike `--env`), so it is the one that forces the
    // generated development credential the local project actually expects.
    commands: remaining.map((selection) =>
      projectCommand(ssoEnableArgs(selection), localRecoverySelector(retry.cwd), cliVersion),
    ),
  };
}

/** {@link retryOptionsFromFlags} for flags as an admitted run carries them. */
export function retryOptionsOf(flags: Record<string, unknown>): SetupRetryOptions {
  return retryOptionsFromFlags(flags as Parameters<typeof retryOptionsFromFlags>[0]);
}

/** The custom connection settings `--sso-*` flags gave, as typed. */
export function customSettingsOf(flags: {
  ssoSlug?: string;
  ssoDisplayName?: string;
  ssoIssuer?: string;
  ssoScopes?: string;
}): CustomFlagValues {
  return {
    slug: flags.ssoSlug,
    displayName: flags.ssoDisplayName,
    issuer: flags.ssoIssuer,
    scopes: flags.ssoScopes,
  };
}

/** How `--server local` with nothing running is refused. */
const NO_LOCAL_SERVER_REFUSAL: Refusal = {
  code: "E_LOCAL_SERVER_NOT_RUNNING",
  message: "Local Zitadel server is not running",
  hint:
    "{reason}Start local Zitadel first, then rerun setup. {scripting}{recovery}" +
    "After setup succeeds, follow its next_commands to start the app and verify registration, logout, and login in the browser.",
  next: ["start", "{setup}"],
};

/** How a `--cwd` that is a file, or lies under one, is refused. */
const NOT_A_DIRECTORY_REFUSAL: Refusal = {
  message: "{cwd} is not a directory",
  hint: "Point --cwd at the app's directory, or at one that does not exist yet for setup to create.",
};

/** How a directory holding a project secret with no configuration is refused. */
const SECRET_WITHOUT_CONFIG_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: ".zitadel/secret exists without zitadel.json",
  hint: "Move the secret aside or restore zitadel.json before running setup.",
};

/** How a repository git cannot answer about is refused. */
const WORKTREE_UNKNOWN_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "Could not tell whether the git working tree is clean: {reason}",
  hint:
    "Setup commits the files it writes, and will not do that without knowing the tree " +
    "started clean. Fix what git is reporting, then run setup again, or pass --no-git to " +
    "set up without touching version control.",
};

/** How a repository where a commit would land in the wrong place is refused. */
const WORKTREE_BLOCKED_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "Setup cannot commit here: {blocked}",
  hint:
    "Setup commits the project so the first release records a commit. Finish or abort what " +
    "is under way, or check out a branch, then run setup again, or pass --no-git to set up " +
    "without touching version control.",
};

/** How a repository holding work the CLI did not write is refused. */
const WORKTREE_DIRTY_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "The git working tree has {parts}",
  hint:
    "Setup commits the project directory so the first release records a commit, and it will not " +
    "do that while there is work it did not write, which would be committed under setup's name. " +
    "Run `git status` to see them, commit or stash them, then run setup again. If you have just scaffolded " +
    "the app yourself, committing it first is the expected step. To set up without touching " +
    "version control at all, pass --no-git.",
  details: {
    modified: "{modified}",
    untracked: "{untracked}",
  },
};

/** How a local server another CLI release started is refused. */
const SERVER_VERSION_REFUSAL: Refusal = {
  code: "E_CONFLICT",
  message: "The local Zitadel server runs {running}, but this CLI ships {expected}",
  hint:
    "A server another CLI release started serves that release's API, so setup would stop " +
    "halfway. Run start to restart it on {expected}; its data stays. {where}" +
    "Then rerun setup.",
  next: ["{start}", "{setup}"],
  details: {
    server_url: "{serverUrl}",
    server_version: "{running}",
    cli_server_version: "{expected}",
  },
};

/** What setup needs to know about the run before it detects or writes anything. */
export type SetupPreflight = Readonly<{
  server: ResolvedServer;
  configured: boolean;
}>;

/** How the preflight turns a command it names into one the reader can run. */
type Suggest = (command: string) => SuggestedCommand;

/** The flags setup's preflight reads. */
type PreflightFlags = Readonly<{
  git?: boolean;
  [flag: string]: unknown;
}>;

function plural(list: readonly unknown[]): string {
  return list.length === 1 ? "" : "s";
}

/**
 * The server setup is about, from `--server` or the cloud default. Refuses
 * `--server local` with nothing running, and says how to start it and how to
 * rerun setup against it once it is.
 */
async function resolveSetupServer(
  flags: PreflightFlags,
  meta: GlobalOptions,
  suggest: Suggest,
): Promise<ResolvedServer> {
  try {
    return await resolveServer({
      cwd: meta.cwd,
      serverFlag: meta.serverFlag,
    });
  } catch (error) {
    const normalized = toZitadelError(error);
    if (normalized.code !== "E_LOCAL_SERVER_NOT_RUNNING") {
      throw error;
    }
    const retry = retryOptionsOf(flags);
    const recovery = ssoRecovery(retry, meta.cliVersion);
    throw refusalError(
      NO_LOCAL_SERVER_REFUSAL,
      {
        reason: normalized.hint ? `${normalized.hint} ` : "",
        scripting:
          retry.sso && retry.sso.length > 0
            ? "The rerun asks for the client id and secret, because a command carries neither. " +
              "To script it instead, add --sso-client-id and --non-interactive, and pipe the secret in. "
            : "",
        recovery:
          recovery.commands.length > 0
            ? `${recovery.hint}${recovery.commands.map((command) => `\`${command}\``).join(" ")} `
            : recovery.hint,
        setup: `setup ${setupRetryFlags({ ...retry, cwd: undefined })}`,
      },
      suggest,
    );
  }
}

/**
 * Refuses a repository setup must not commit in. One snapshot answers all
 * three questions: git is asked once, not once per refusal.
 */
function refuseWorktree(state: WorktreeState): void {
  if (state.kind === "unknown") {
    throw refusalError(WORKTREE_UNKNOWN_REFUSAL, {
      reason: state.reason,
    });
  }
  if (state.kind === "blocked") {
    throw refusalError(WORKTREE_BLOCKED_REFUSAL, {
      blocked: state.blocked,
    });
  }
  if (state.kind !== "dirty") {
    return;
  }
  const parts = [
    state.modified.length > 0
      ? `${state.modified.length} uncommitted change${plural(state.modified)}`
      : undefined,
    state.untracked.length > 0
      ? `${state.untracked.length} untracked file${plural(state.untracked)}`
      : undefined,
  ].filter((part) => {
    return part !== undefined;
  });
  throw refusalError(WORKTREE_DIRTY_REFUSAL, {
    parts: parts.join(" and "),
    modified: state.modified,
    untracked: state.untracked,
  });
}

/**
 * Refuses a local server another CLI release started. `start` restarts such a
 * server, but one left running stays that release's until `start` runs again,
 * and its API is that release's: setup would create the project, then fail
 * deploying the default schema and flow, and `--force` would not help.
 *
 * Only a binary runtime records the version it runs, and only release versions
 * are compared: an override records `override`, which says nothing about its
 * API. An unreadable `runtime.json` is doctor's to report, not setup's.
 */
async function refuseOtherReleasesServer(
  flags: PreflightFlags,
  meta: GlobalOptions,
  suggest: Suggest,
): Promise<void> {
  const nearest = await readNearestRuntimeMetadata(meta.cwd).catch(() => {
    return undefined;
  });
  const runtime = nearest?.runtime;
  if (!nearest || runtime?.backend !== "binary" || runtime.server_url !== meta.source) {
    return;
  }
  const expected = LocalServer.bundledVersion();
  if (
    expected === undefined ||
    !semver.valid(expected) ||
    !semver.valid(runtime.server_version) ||
    runtime.server_version === expected
  ) {
    return;
  }
  throw refusalError(
    SERVER_VERSION_REFUSAL,
    {
      running: runtime.server_version,
      expected,
      serverUrl: runtime.server_url,
      start: nearest.dir === meta.cwd ? "start" : `start ${Cmd.option("--cwd", nearest.dir)}`,
      where:
        nearest.dir === meta.cwd
          ? ""
          : `Run start in ${nearest.dir}, where the server was started. `,
      setup: `setup ${setupRetryFlags({ ...retryOptionsOf(flags), cwd: undefined })}`,
    },
    suggest,
  );
}

/**
 * Everything setup checks before it detects, creates or writes anything: the
 * server it is about, that the directory can hold an app, that a half-removed
 * project is not sitting there, and that git is in a state setup may commit
 * in. A directory already set up skips the git and server-version checks,
 * which are about making a project rather than changing one.
 */
export async function setupPreflight(
  flags: PreflightFlags,
  meta: GlobalOptions,
  suggest: Suggest,
): Promise<SetupPreflight> {
  const server = await resolveSetupServer(flags, meta, suggest);
  if (!(await isDirectoryOrMissing(meta.cwd))) {
    throw refusalError(NOT_A_DIRECTORY_REFUSAL, {
      cwd: meta.cwd,
    });
  }
  // The version check compares against the server this run is about, so the
  // rest of the preflight sees the resolved one.
  const resolved: GlobalOptions = {
    ...meta,
    source: server.value,
  };
  const configured = await hasZitadelConfig(meta.cwd);
  if (!configured && (await hasZitadelSecret(meta.cwd))) {
    throw refusalError(SECRET_WITHOUT_CONFIG_REFUSAL, {});
  }
  if (configured) {
    return {
      server,
      configured,
    };
  }
  if (flags.git !== false) {
    refuseWorktree(await inspectWorktree(meta.cwd));
  }
  await refuseOtherReleasesServer(flags, resolved, suggest);
  return {
    server,
    configured,
  };
}

/** The `--sso-*` flags that describe a custom connection, and whether one is needed. */
const CUSTOM_SETTINGS = [
  { name: "ssoSlug", flag: "--sso-slug", needed: true },
  { name: "ssoDisplayName", flag: "--sso-display-name", needed: true },
  { name: "ssoIssuer", flag: "--sso-issuer", needed: true },
  { name: "ssoScopes", flag: "--sso-scopes", needed: false },
] as const;

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

const DESIGN_REMOVED_REFUSAL: Refusal = {
  message: "setup no longer applies a login template, so --design was removed",
  hint: `Rerun setup without --design. ${PAGE_LAYOUT_HINT} To own the widget's structure after setup, eject one of: ${BRANDING_DESIGNS.join(", ")}.`,
  next: ["branding eject"],
};

const CLIENT_ID_NEEDS_SSO_REFUSAL: Refusal = {
  message: "--sso-client-id needs --sso",
  hint: "Name the provider with --sso, e.g. --sso google.",
};

const SETTING_NEEDS_SSO_REFUSAL: Refusal = {
  message: `{flag} needs --sso ${CUSTOM_PROVIDER}`,
  hint: `Name the provider with --sso ${CUSTOM_PROVIDER}.`,
};

const SETTINGS_NEED_CUSTOM_REFUSAL: Refusal = {
  message: "{names} only applies to a custom connection",
  hint: `Add --sso ${CUSTOM_PROVIDER}, or remove {them}.`,
  details: {
    flags: "{flags}",
  },
};

const CUSTOM_CONNECTION_INCOMPLETE_REFUSAL: Refusal = {
  message: "A custom connection needs {list}",
  hint: `Describe the connection, e.g. ${customExample(SETUP_FLAG_NAMES)}`,
  details: {
    missing: "{missing}",
  },
};

const SSO_NEEDS_CLIENT_ID_REFUSAL: Refusal = {
  message: "--sso {sso} needs --sso-client-id",
  hint: "Register {registration} and pass its client id.",
};

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
export function refuseUnusableFlags(
  flags: SetupFlagsToCheck,
  scripted: boolean,
  suggest: (command: string) => SuggestedCommand,
): void {
  if (flags.design !== undefined) {
    throw refusalError(DESIGN_REMOVED_REFUSAL, {}, suggest);
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
        names: given.map((setting) => setting.flag).join(", "),
        them: given.length === 1 ? "it" : "them",
        flags: given.map((setting) => setting.flag),
      });
    }
  }
  if (!scripted) {
    return;
  }
  if (flags.sso === CUSTOM_PROVIDER) {
    const missing = CUSTOM_SETTINGS.filter((setting) => {
      return setting.needed && flags[setting.name] === undefined;
    }).map((setting) => setting.flag);
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
 * How a setting that holds nothing is refused: what to do about an empty value
 * is to pass one or leave the flag out, which is not what to do about a value
 * the provider would reject, so the two are worded apart.
 */
const EMPTY_SETTING: Refusal = {
  message: "the value is empty",
  hint: "Pass a value for {input}, or omit it entirely.",
};

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
 * everything else as `refused` words it.
 */
function readsFilled<T>(refused: Refused<T>, empty: Refusal = EMPTY_SETTING) {
  const blank = reads<string>({
    schema: filled,
    refusal: empty,
  });
  const value = reads(refused);
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
const UNAVAILABLE_RENDERER_IDS = RENDERER_IDS.filter((id) => !AVAILABLE_RENDERER_IDS.includes(id));
const RENDERER_FLAG_DESCRIPTION =
  UNAVAILABLE_RENDERER_IDS.length === 0
    ? "Renderer (default: react)."
    : `Renderer (default: react). Not yet available: ${UNAVAILABLE_RENDERER_IDS.join(", ")}.`;

/** The message the release setup publishes carries. */
const INITIAL_DEPLOY_MESSAGE = "Initial deployment from zitadel setup";

/**
 * The selector appended to setup's credential-recovery commands. `variable set`
 * is an `EnvironmentCommand` that resolves the project and server from the
 * environment, where the process environment outranks the `.env` files — so a
 * bare retry in a shell holding production values would publish to the wrong
 * project. Pinning `--env-file .env.development.local` (the file setup wrote)
 * forces the local project the recovery is for, because `--env-file` outranks
 * the process environment (unlike `--env`); same reasoning as the SSO recovery.
 */
function recoverySelector(cwd: string | undefined): EnvironmentSelector {
  // `--cwd` too, as typed, and the file under it: `--env-file` is read from
  // the shell's directory, so a recovery run from where setup was launched
  // reads the file setup wrote.
  return environmentSelectorSuffix({
    envFile: projectEnvFile(cwd, ".env.development.local"),
    cwd,
  });
}

/** `zitadel setup` — create a project and scaffold local auth.
 *
 * Detects the framework (or, for an empty directory, picks the one to
 * scaffold), runs the wizard prompts to fill in any answers not pre-supplied
 * by flags, scaffolds the new app only then (never on a dry run), creates the
 * remote project without server fallback defaults, patches the local files via
 * `Orca`'s framework patcher, then scaffolds the editable `.zitadel/**`
 * configuration through the configuration library and deploys it.
 *
 * Every interactive question lives in {@link SETUP_PROMPTS} (the main wizard
 * — each entry is a small class) and {@link PickFrameworkPrompt} (the
 * empty-directory framework choice, before the main wizard).
 */
const MIN_PORT = 1;
const MAX_PORT = 65_535;

/**
 * A TCP port, refusing what is not a whole number from 1 to 65535, which is no
 * port a server can listen on.
 */
const PORT: Refused<number> = {
  schema: whole.pipe(z.number().min(MIN_PORT).max(MAX_PORT)),
  refusal: {
    message: "{value} is not a TCP port",
    hint: "Use a TCP port from {min} to {max}.",
  },
  values: {
    min: MIN_PORT,
    max: MAX_PORT,
  },
};

/**
 * The port a value names, for the dev-port prompt, so a port typed at the
 * prompt and one passed as `--dev-port` are held to the same rule.
 */
export function readPort(value: string): Parsed<number> {
  const parsed = PORT.schema.safeParse(value);
  return parsed.success
    ? {
        ok: true,
        value: parsed.data,
      }
    : {
        ok: false,
        problem: "Must be a port number",
      };
}

export default class Setup extends Destructive(BaseCommand) {
  static override description =
    "Create a Zitadel project and scaffold local auth. An interactive setup ends with a note about the Zitadel agent skills, shown once per machine; set NO_SKILLS_PROMPT=1 to hide it.";
  static override group = CommandGroups.gettingStarted;
  static override groupOrder = 1;
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
    framework: Flags.string({ description: "Framework to target.", options: FRAMEWORK_OPTIONS }),
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
    // Removed in #1039 — setup no longer applies a login template. Kept
    // hidden so scripts and agents still passing it get a targeted error
    // pointing at `branding eject` instead of oclif's unknown-flag error.
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

  protected async execute({ flags }: Admitted<typeof Setup>): Promise<JsonEnvelope> {
    refuseUnusableFlags(flags, this.nonInteractive, (next) => {
      return this.suggestUnscoped(next);
    });
    const preflight = await setupPreflight(flags, this.meta, (next) => {
      return this.suggestUnscoped(next);
    });
    this.meta = {
      ...this.meta,
      source: preflight.server.value,
    };
    if (preflight.configured) {
      // An app already set up has nothing left to scaffold, but an explicit
      // --dev-port is how it moves to another port.
      if (flags.devPort !== undefined) {
        return this.moveToDevPort(this.cwd, flags.cwd, flags.devPort, this.dryRun);
      }

      return this.emit({
        status: "skipped",
        reason: "already-initialized",
      });
    }

    // Resolved before anything is detected, created or written: an
    // inconsistent set of --sso flags is a mistake in the command line, and
    // reporting it after a project has been created would leave the developer
    // to clean up.
    // It cannot ask a `confirm`, so setup's `--force`, which permits
    // overwriting files, never answers one of its questions.
    const wizardInput: Asker = this.input;
    const ssoFromCommandLine = await ssoFromFlags(
      flags,
      this.nonInteractive,
      this.dryRun,
      wizardInput,
      this.config.version,
    );

    const orca = createOrca();

    consola.start(`Detecting framework in ${shortPath(this.cwd, this.env)}`);
    // The app the questions are about: the one detected here, or else a new
    // one. Setup creates a new app only once it has every answer, just before
    // it patches it, so cancelling a question leaves the directory as it was,
    // and a dry run never creates one. Until then only its framework and dev
    // port are known.
    let app: Readonly<{ framework: string; devPort: number }>;
    let detected: FrameworkFacts | undefined;
    // Whether `--force` scaffolds beside entries the directory already held,
    // other than the local runtime `start` leaves, which counts as empty.
    let scaffoldedBesideFiles = false;
    try {
      detected = await orca.detect(this.cwd, flags.framework);
      app = { framework: detected.id, devPort: detected.devPort };
      consola.success(
        `Detected ${orca.displayName(detected.id)}${detected.devPort ? ` (dev port ${detected.devPort})` : ""}`,
      );
    } catch (error) {
      if (error instanceof ZitadelError && error.code === "E_FRAMEWORK_NOT_DETECTED") {
        const target = await inspectScaffoldTarget(this.cwd);
        if (!target.scaffoldable && !this.force) {
          throw frameworkDetectionWithScaffoldTarget(error, this.cwd, target);
        }
        consola.info(
          target.scaffoldable
            ? "Fresh app directory — setup scaffolds a new project"
            : "Non-empty directory with --force — setup scaffolds a new project",
        );
        app = await orca.planScaffold(
          this.cwd,
          await resolveScaffoldFramework(flags.framework, this.nonInteractive, orca, {
            retry: retryOptionsOf(flags),
            serverFlag: this.meta.serverFlag,
            cliVersion: this.config.version,
            ask: wizardInput,
          }),
        );
        scaffoldedBesideFiles = !target.scaffoldable;
      } else {
        throw error;
      }
    }
    // A new app, created below, or on a dry run only previewed.
    const scaffoldedFramework = detected === undefined;
    this.recordTelemetry({
      framework: app.framework,
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
    // An explicit --dev-port overrides the detected port for the whole run, so
    // the issuer and the registered origin track the requested port (and several
    // apps can be scaffolded on distinct ports). The config edits set the
    // dev-server port only when it is unset, so a project that already pins a
    // different port in vite.config.*/angular.json keeps it — pass --dev-port to
    // match that pin (or remove it) if the origin check rejects requests.
    if (flags.devPort !== undefined) {
      app = { ...app, devPort: flags.devPort };
    }

    const defaultAnswers: SetupAnswers = {
      server: this.meta.source,
      devPort: app.devPort,
      preset: (flags.preset as SetupPreset | undefined) ?? DEFAULT_SETUP_PRESET,
      useCase: (flags.useCase as SetupUseCase | undefined) ?? DEFAULT_SETUP_USE_CASE,
      sso: ssoFromCommandLine === undefined ? [] : [ssoFromCommandLine],
      passwordMinLength: flags.passwordMinLength,
    };

    const asks = !this.nonInteractive && !this.dryRun;
    if (asks && (!scaffoldedFramework || flags.framework !== undefined)) {
      // Asking which framework to scaffold opened the wizard already.
      intro("Zitadel setup");
    }
    const promptCtx = {
      input: wizardInput,
      framework: { id: app.framework, displayName: orca.displayName(app.framework) },
      suggest: (args: string) => projectCommand(args, recoverySelector(flags.cwd), this.cliVersion),
      cwd: this.cwd,
      frameworkChosen: scaffoldedFramework || flags.framework !== undefined,
      serverFlag: this.meta.serverFlag,
      devPortFromFlag: flags.devPort !== undefined,
      presetFromFlag: flags.preset !== undefined,
      useCaseFromFlag: flags.useCase !== undefined,
      ssoFromFlag: flags.sso !== undefined,
      passwordMinLengthFromFlag: flags.passwordMinLength !== undefined,
      developmentBuild: isDevelopmentBuild(),
    };
    const answers = asks
      ? await SETUP_PROMPTS.reduce(
          async (previous, prompt) => prompt.ask(await previous, promptCtx),
          Promise.resolve(defaultAnswers),
        )
      : defaultAnswers;
    if (asks) {
      note(
        signInSummary(
          signInOf(answers),
          answers.sso.map((draft) => providerOf(draft.selection).displayName),
        ),
        "Sign-in",
      );
      outro("Configuration captured");
    } else if (flags.devPort === undefined && !(await LocalServer.isPortFree(answers.devPort))) {
      // The wizard asks for another port when the detected one is taken. A run
      // that asks nothing still pins the dev script to it, so it says so, with
      // the command that puts the app on a free one.
      reportWarning(
        portInUseWarning(answers.devPort, await LocalServer.nextFreePort(answers.devPort), (args) =>
          this.suggestUnscoped(args),
        ),
      );
    }

    // The interactive prompts can override the flag/default preset and use
    // case recorded at framework_resolved — re-record so
    // telemetry carries the values that actually scaffold.
    this.recordTelemetry({
      preset: answers.preset,
      use_case: answers.useCase,
      // One slug, "none", or "multiple" -- never a joined set. A dimension's
      // value space has to stay enumerable: comma-joining n providers makes it
      // combinatorial, and the question telemetry answers here is whether a
      // project enabled a provider at all, not which combination.
      sso:
        answers.sso.length === 0
          ? "none"
          : answers.sso.length === 1
            ? answers.sso[0]
              ? selectionName(answers.sso[0].selection)
              : "none"
            : "multiple",
      // Whether a minimum goes into the password policy, never the value. None
      // given is the recommended one (`PasswordPolicy.initial`), unless `--force`
      // keeps a policy file: `files_patched` records what was published.
      password_policy: answers.passwordMinLength === null ? "empty" : "set",
    });

    const issuer = issuerFromPort(answers.devPort);
    const rendererId = flags.renderer ?? "react";

    // Fresh scaffolds keep the widgets' full-page chrome; a pre-existing
    // route-based app gets embeddable cards inside its own layout (ADR 044).
    const posture = derivePosture(app.framework, scaffoldedFramework);
    const patchContext = (framework: FrameworkFacts, project: CreatedProject): PatchContext => ({
      framework,
      rendererId,
      project,
      issuer,
      server: answers.server,
      cliVersion: this.cliVersion,
      scaffoldedFramework,
      posture,
      preset: answers.preset,
      useCase: answers.useCase,
    });
    const patcher = orca.patcherFor(app.framework);
    // The schema, flow, connection and policy files setup writes only once the
    // project exists: a conflict on one of those left the project behind, and
    // the rerun's `.env.local` kept pointing at it. Planned, and so refused,
    // before anything is written, a new app included. Read-only, so a dry run
    // reports them too.
    const planned = await scaffoldOf(this.cwd, this.force, answers);

    // A new app is created only now, with every answer in hand. A dry run
    // creates none, so it has no app to patch.
    const scaffolding = detected === undefined && !this.dryRun;
    if (detected === undefined && this.dryRun) {
      consola.info(`Would scaffold a new ${app.framework} project (dry run)`);
    }
    if (scaffolding) {
      consola.start(`Scaffolding a new ${app.framework} project`);
    }
    const newApp = scaffolding
      ? await orca.scaffoldUndoably(this.cwd, app.framework, this.force)
      : undefined;
    if (newApp !== undefined) {
      consola.success(`Scaffolded ${newApp.facts.id} skeleton`);
    }
    const created = detected ?? newApp?.facts;
    // The DevPortPrompt can change the port interactively, so fold the answer
    // back into the framework: the patched dev-server config reads
    // `framework.devPort`, and it must agree with the issuer and the registered
    // origin (both derived from `answers.devPort`).
    const framework =
      created === undefined ? undefined : { ...created, devPort: answers.devPort, url: issuer };

    // A new app is kept only once its default resources are in place. A
    // failure before that, Ctrl-C included, removes it again and puts back
    // what the directory held, so the rerun scaffolds a new app instead of
    // taking a half-set-up one for an app the developer brought.
    let project: CreatedProject;
    let result: Awaited<ReturnType<typeof patcher.patch>>;
    let scaffolded: ScaffoldedConfiguration;
    try {
      if (framework !== undefined && !this.dryRun) {
        // Patch as a dry run first, against a placeholder project: a file setup
        // would refuse to overwrite (E_CONFLICT), such as an existing app's own
        // root component, stops setup here, before it creates a project and
        // writes `zitadel.json`. Without this, the conflict surfaced after both,
        // and every rerun skipped the directory as already set up.
        await patcher.patch(patchContext(framework, dryRunProject(issuer)), {
          cwd: this.cwd,
          dryRun: true,
          force: this.force,
        });
      }

      // `POST /projects` is unauthenticated. CLI-managed projects opt out of
      // server fallback defaults; setup writes the default configuration files
      // and the first deploy publishes them.
      consola.start(`Creating project on ${answers.server}${this.dryRun ? " (dry run)" : ""}`);
      const unauthClient = createZitadelClient({
        userAgent: userAgent(),
        baseUrl: answers.server,
        signal: this.signal,
      });
      const projectName = defaultProjectName(this.cwd, app.framework);
      // Register the app's own origin so the backend's origin check allows
      // requests the dev proxy forwards from it.
      project = this.dryRun
        ? dryRunProject(issuer)
        : await createProjectWithLocalHint(
            unauthClient,
            answers.server,
            this.cliVersion,
            projectName,
            issuer,
            {
              // Resolved values, not raw flags: the wizard may have picked the
              // preset, use case, or dev port interactively, and the retry must
              // reproduce those choices — the issuer registered with the
              // project derives from the port.
              ...retryOptionsOf(flags),
              framework: app.framework,
              preset: answers.preset,
              useCase: answers.useCase,
              devPort: answers.devPort,
              sso: answers.sso.map((answer) => answer.selection),
              passwordMinLength: answers.passwordMinLength,
            },
          );
      consola.success(`Created project ${escapeControlCharacters(project.id)}`);
      this.recordTelemetry({ step: "project_created" });

      // `.env.local` as it is before the patch merges this project's id and
      // secret into it, so a failure below can put it back.
      const envFilesBefore = await readCredentialEnvFiles(this.cwd);
      if (framework === undefined) {
        // What the patch writes depends on the files the scaffold creates.
        consola.info("Would patch the new project (dry run): its files come from the scaffold");
        result = {
          dryRun: this.dryRun,
          files: [],
          filesWritten: [],
          filesSkipped: [],
          depsAdded: [],
        };
      } else {
        consola.start(`Patching project files${this.dryRun ? " (dry run)" : ""}`);
        try {
          result = await patcher.patch(patchContext(framework, project), {
            cwd: this.cwd,
            dryRun: this.dryRun,
            force: this.force,
          });
        } catch (error) {
          // The dry run above already ruled out conflicts, so this is an I/O
          // failure partway through. Remove the setup markers and put
          // `.env.local` back, as a failed configuration write does below, so a
          // rerun starts over.
          if (!this.dryRun) {
            await removeSetupMarkers(this.cwd);
            await restoreCredentialEnvFiles(this.cwd, envFilesBefore);
          }
          throw error;
        }
      }
      for (const file of result.filesWritten) {
        const sentence = describeWrittenFile(relativeDisplay(this.cwd, file), this.dryRun);
        if (sentence) {
          consola.info(sentence);
        }
      }
      for (const file of result.filesSkipped) {
        consola.info(`Left ${relativeDisplay(this.cwd, file)} unchanged (already matches target)`);
      }
      try {
        scaffolded = this.dryRun
          ? { filesWritten: [], passwordMinLength: signInOf(answers).password_min_length }
          : await this.writeConfiguration(answers, project);
      } catch (error) {
        // Setup is not atomic: the patcher already wrote `zitadel.json` (the
        // marker the already-initialized guard skips on) and `.zitadel/secret`.
        // Remove both so a rerun starts a fresh setup instead of being skipped
        // forever with no default schema or login flow anywhere. The project
        // has nothing deployed, so its credentials are not worth keeping, and
        // `.env.local`, where the patch merged them, goes back to what it held
        // before.
        // Only these, and never a connection file: those are tenant-owned, and
        // setup neither writes over nor removes one -- unless it is part of a
        // new app, which goes as a whole.
        await removeSetupMarkers(this.cwd);
        await restoreCredentialEnvFiles(this.cwd, envFilesBefore);
        const cause = toZitadelError(error);
        throw new ZitadelError(cause.code, `Default configuration setup failed: ${cause.message}`, {
          hint: this.configurationFailureHint(cause, newApp !== undefined),
          nextCommands:
            cause.nextCommands ??
            (newApp === undefined ? [this.suggestUnscoped("setup --force")] : []),
          details: cause.details,
        });
      }
    } catch (error) {
      if (newApp !== undefined) {
        await removeNewApp(newApp, this.cwd, this.env);
      }
      throw error;
    }
    try {
      await newApp?.keep();
    } catch (error) {
      // Setup itself is done; only what the scaffold replaced is left behind.
      reportWarning(
        `Could not delete what the new app replaced, kept beside ${this.cwd}: ${toZitadelError(error).message}`,
      );
    }
    for (const file of scaffolded.filesWritten) {
      const sentence = describeWrittenFile(relativeDisplay(this.cwd, file), this.dryRun);
      if (sentence) {
        consola.info(sentence);
      }
    }
    const allFilesWritten = [...result.filesWritten, ...scaffolded.filesWritten];
    if (framework !== undefined) {
      consola.success(
        `Patched ${allFilesWritten.length} file${allFilesWritten.length === 1 ? "" : "s"}` +
          (result.filesSkipped.length > 0 ? ` (${result.filesSkipped.length} unchanged)` : ""),
      );
    }
    this.recordTelemetry({
      step: "files_patched",
      files_written_count: allFilesWritten.length,
    });
    // The minimum length comes from the policy setup published: a file
    // `--force` kept decides it as much as the answers do.
    const signIn: SignIn = {
      ...signInOf(answers),
      password_min_length: scaffolded.passwordMinLength,
    };
    if (!this.dryRun) {
      // What was published, which a policy file `--force` keeps decides as much
      // as the answers recorded before. A dry run publishes nothing and keeps
      // those.
      this.recordTelemetry({
        password_policy: scaffolded.passwordMinLength === null ? "empty" : "set",
      });
    }

    // After the connection file is written, not before: a credential published
    // under a name nothing references yet is an orphan in the project's
    // variables, and a setup that fails in between would leave one behind. And
    // before the first deploy, which carries the connection and resolves its
    // `${{ NAME }}` from the variables the project holds by then. Neither
    // credential reaches the filesystem — both go to the project's variables,
    // against Zitadel Cloud as much as against a local server. A refusal is
    // reported rather than failing setup: everything else is already written,
    // and `variable set` publishes it later.
    // One outcome per provider, keyed by slug: the summary reports each
    // separately, because one provider's publish can land while another's does
    // not, and telling the developer "the secret did not reach the project"
    // without saying whose would leave them guessing.
    const ssoOutcomes = new Map<
      ConnectionSlug,
      { clientId: PublishState; secret: SecretOutcome }
    >();
    if (answers.sso.length > 0 && !this.dryRun) {
      const publish = ssoCredentialPublisher(answers.server, project, this.signal);
      // Only here do both credentials have to exist, and the type says so.
      for (const answer of completeSso(answers.sso)) {
        const slug = providerOf(answer.selection).slug;
        const { clientId: idVariable, clientSecret: variable } = credentialVariables(slug);
        const clientId = await publishClientId({
          name: idVariable,
          value: answer.credentials.clientId,
          publish,
        });
        const secret = await storeClientSecret({
          name: variable,
          value: answer.credentials.secret,
          publish,
        });
        ssoOutcomes.set(slug, { clientId, secret });
        if (answer.endpoints?.issuer !== undefined) {
          // Said out loud: a connection pointing somewhere other than the
          // vendor is not what the developer will want in the end, and nothing
          // else in the summary would show it.
          reportWarning(
            `${providerOf(answer.selection).displayName} points at ` +
              `${answer.endpoints.issuer}, not the provider`,
          );
        }
        reportClientIdOutcome(idVariable, clientId, this.cliVersion, recoverySelector(flags.cwd));
        // The wizard refuses an empty secret, so a deferred publish here only
        // ever means there was no project to publish to.
        reportSecretOutcome(secret, this.cliVersion, false, recoverySelector(flags.cwd));
      }
    }

    if (framework !== undefined && !this.dryRun) {
      // Record what was actually scaffolded so `doctor` can later verify the
      // app files without guessing from current templates (missing vs edited
      // vs user-adopted) and `doctor --fix` can restore exactly the missing
      // ones. Best-effort: a failure here only degrades doctor to its
      // template-derived fallback, it never breaks setup.
      try {
        await writeScaffoldManifest({
          cwd: this.cwd,
          actions: orca.patcherFor(framework.id).artifacts({ framework, rendererId }),
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
      cliVersion: this.cliVersion,
      cwd: this.cwd,
      ...(flags.cwd === undefined ? {} : { cwdFlag: flags.cwd }),
      depsAdded: result.depsAdded,
      dryRun: this.dryRun,
      env: this.env,
      issuer,
      json: this.isJson,
      selector: recoverySelector(flags.cwd),
      scaffoldedFramework,
      skipInstall: Boolean(flags.skipInstall),
    });

    this.recordTelemetry({
      step: "dependencies_installed",
      package_manager: installOutcome.install.package_manager,
    });

    // The commit exists so that the release a later `deploy` builds records
    // the commit it came from; without it that deploy has no baseline and the
    // one after it can show no diff (#1651).
    const commit = await this.makeInitialCommit(this.cwd, this.dryRun, flags.git !== false);

    // Setup publishes what it scaffolded, after the commit so the release
    // records it, so the sign-in setup asks the developer to verify next is
    // served that release rather than the newest stored revisions (#2331).
    const deployment = await this.deployScaffoldedProject({
      cwd: this.cwd,
      server: answers.server,
      project,
      dryRun: this.dryRun,
      selector: recoverySelector(flags.cwd),
    });
    // A failed deploy leaves the project with no release, so the deploy that
    // fixes it leads both surfaces.
    const deployCommand = projectCommand(DEPLOY_ARGS, recoverySelector(flags.cwd), this.cliVersion);
    const deployStep =
      deployment === undefined && !this.dryRun
        ? {
            actions: [`Deploy .zitadel/ so the project serves its release: ${deployCommand}`],
            boxActions: [
              {
                text: "Deploy .zitadel/ so the project serves its release:",
                command: deployCommand,
              },
            ],
            commands: [deployCommand],
          }
        : { actions: [], boxActions: [], commands: [] as SuggestedCommand[] };

    const writtenRel = allFilesWritten.map((file) => relativeDisplay(this.cwd, file));
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
    // Nudged on the cloud, and on a local server that actually hosts the
    // platform plane: `claimState` is offline and gates local to
    // not-applicable, but setup is online anyway, so it asks the server's
    // runtime document (see localServerHostsPlatform). A dry run contacts no
    // platform, so it previews the nudge for local servers optimistically
    // instead of probing.
    // The deadline is concrete because the server enforces the claim window
    // at claim time and the project was created moments ago, so created_at
    // computes the same date the platform will hold the user to. A dry run
    // gets the generic wording: its stand-in project has a fixed past
    // created_at, and no real window started anyway.
    // On a CLI-managed local server the developer already exists as the local
    // admin, so the project is attached to their team right away and
    // `zitadel claim` has nothing left to do. Claiming an anonymous project
    // stays a cloud journey.
    let ownedByLocalAdmin: { email: string; team_id: string } | undefined;
    const isLocal = serverKind.value(answers.server) === "local";
    const hostsPlatform =
      !this.dryRun && isLocal ? await localServerHostsPlatform(answers.server) : false;
    if (hostsPlatform) {
      // The runtime document naming the platform project does not prove a
      // claim can complete (a deployment can pin that project without the
      // platform bootstrap, which leaves the admin without a personal team),
      // so attaching the project is best-effort: on failure the project stays
      // unclaimed and setup falls back to the usual claim nudge instead of
      // failing after it has already written the app files. Reading the admin
      // belongs inside the guard for the same reason — a malformed
      // `admin.json` must not fail a setup that already wrote the app.
      try {
        const admin = await findLocalAdminFor(this.cwd, answers.server);
        if (!admin) {
          // The console lists only projects the signed-in person can manage,
          // so an unattached project is one the local admin never sees. A
          // server started by hand has no local admin anywhere, hence the "if".
          reportWarning(
            `No local admin for ${answers.server} in ${this.cwd} or its parents, so the project is not attached to a team and the local console will not list it. If \`zitadel start\` started this server, run setup from the directory it ran in, or one inside it.`,
          );
        }
        if (admin) {
          const owner = await claimProjectAsAdmin({
            serverUrl: answers.server,
            projectId: project.id,
            projectSecret: project.project_secret,
            admin,
            signal: this.signal,
          });
          // The team is whichever one the platform attached the project to —
          // the admin's earliest active membership, which need not be the team
          // its bootstrap document named.
          const secret = await readZitadelSecret(this.cwd);
          await writeZitadelSecret(this.cwd, {
            ...secret,
            team_id: owner.team_id,
            claimed_at: owner.claimed_at,
          });
          ownedByLocalAdmin = { email: admin.email, team_id: owner.team_id };
          consola.success(`Project owned by ${admin.email} (team ${owner.team_id})`);
        }
      } catch (error) {
        reportWarning(
          `Could not attach the project to the local admin: ${toZitadelError(error).message}`,
        );
      }
    }

    const deadline = this.dryRun ? undefined : claimWindowDeadline(project.created_at);
    const nudgeClaim =
      !ownedByLocalAdmin &&
      (claimState({ secret: {}, server: answers.server }).kind === "detached" ||
        (isLocal && (this.dryRun || hostsPlatform)));
    const claimNudge = nudgeClaim
      ? {
          actions: [claimAction(this.cliVersion, deadline, recoverySelector(flags.cwd))],
          boxActions: [claimBoxAction(this.cliVersion, deadline, recoverySelector(flags.cwd))],
          commands: [claimCommand(this.cliVersion, recoverySelector(flags.cwd))],
        }
      : { actions: [], boxActions: [], commands: [] as SuggestedCommand[] };
    // Only when the project is the local admin's: the console lists nothing
    // else for them, so the command would open an empty console otherwise.
    // `console` finds the server from its directory up, so a run with `--cwd`
    // passes it on.
    const consoleCommand = this.suggestUnscoped("console");
    const consoleStep = ownedByLocalAdmin
      ? {
          actions: [
            `Manage the project in the local console as ${ownedByLocalAdmin.email}: ${consoleCommand}`,
          ],
          boxActions: [
            {
              text: `Manage the project in the local console, signed in as ${ownedByLocalAdmin.email}:`,
              command: consoleCommand,
            },
          ],
          commands: [consoleCommand],
        }
      : { actions: [], boxActions: [], commands: [] as SuggestedCommand[] };
    // A run that skipped social sign-in says how to add it later, the way
    // `consoleStep` says how to open the console.
    const ssoCommand = projectCommand(
      "auth-method sso enable --provider google",
      recoverySelector(flags.cwd),
      this.cliVersion,
    );
    const ssoStep =
      answers.sso.length === 0
        ? {
            actions: [`Add social sign-in whenever you are ready: ${ssoCommand}`],
            boxActions: [
              {
                text: "Add social sign-in, such as Google, whenever you are ready:",
                command: ssoCommand,
              },
            ],
            commands: [ssoCommand],
          }
        : { actions: [], boxActions: [], commands: [] as SuggestedCommand[] };
    // The structured report is human-only. Under `--json` we let the
    // envelope returned from `this.emit(...)` be the sole stdout
    // payload (oclif requires single-doc JSON).
    if (!this.isJson) {
      const projectFacts = await detectProjectFacts(this.cwd, app.framework);
      const sections = buildSummary({
        projectFacts,
        writtenRel,
        depsAdded: result.depsAdded,
        project,
        server: answers.server,
        issuer,
        scaffoldedFramework,
        scaffoldedBesideFiles,
        connections: planned.connections,
        signIn,
      });
      // Frame the report in a consola box so it reads as a distinct
      // status panel separate from the per-step narration above it.
      // `box` accepts ANSI-styled text in the message body, so our
      // pre-coloured rows (path/url/id helpers) survive intact.
      // `wrapForBox` caps the content at the terminal width: consola sizes
      // the frame to the longest line, so an unwrapped sentence wider than
      // the window would break the right border.
      consola.box({
        title: "Zitadel is ready",
        message: wrapForBox(
          [
            renderSummary(sections),
            "",
            renderBoxActions([
              ...deployStep.boxActions,
              ...installOutcome.boxActions,
              ...consoleStep.boxActions,
              ...ssoStep.boxActions,
              ...claimNudge.boxActions,
            ]),
          ].join("\n"),
        ),
        style: BOX_STYLE.success,
      });
      // After the steps that start the app and test sign-in, outside the box so
      // the command can be copied without its border.
      consola.log(`\n${exploreAllCommands(this.cliVersion)}`);
      // Then the skills note, once per machine, as the last thing setup prints.
      // Only on a run that succeeded: a failed or cancelled setup never reaches here,
      // so it does not use up the once-per-machine note.
      await showSkillsHint({
        env: this.env,
        interactive: !this.dryRun && !this.nonInteractive && this.isTTY,
        cliVersion: this.cliVersion,
      });
    }

    // The box holds the next steps, so the base command does not repeat them.
    const nextShown: StepsShown | undefined = this.isJson ? undefined : asStepsShown();

    // The box and the per-step narration already showed the summary, so `pretty`
    // is empty and stdout carries it once.
    return this.emit({
      status: "ok",
      data: {
        title: "Zitadel is ready.",
        project: { project_id: project.id, issuer },
        framework: app.framework,
        server: answers.server,
        files_written: allFilesWritten.map((file) => relativeDisplay(this.cwd, file)),
        // Typed per-artifact rows for the scaffolded app files (the
        // configuration files continue to report through files_written): one row per
        // touched path with kind (file/dir) and action (create/update), so
        // agents can verify what setup did without parsing narration.
        files: result.files.map((file) => ({
          path: relativeDisplay(this.cwd, file.path),
          kind: file.kind,
          action: file.action,
        })),
        files_skipped: result.filesSkipped.map((file) => relativeDisplay(this.cwd, file)),
        install: installOutcome.install,
        git: gitReport(commit),
        // What sign-in and registration are configured to do, read off what
        // setup published rather than the preset's name.
        sign_in: signIn,
        // A list, one entry per provider enabled during scaffolding, empty
        // when none was. An agent reading this needs to know which provider a
        // deferred publish belongs to, so the outcomes stay per entry.
        sso: planned.connections.map((entry) => {
          const slug = providerOf(entry.chosen.selection).slug;
          const outcome = ssoOutcomes.get(slug);
          return {
            provider: selectionName(entry.chosen.selection),
            slug,
            client_id: entry.chosen.credentials.clientId ?? null,
            connection: entry.connection.path,
            // What the developer registers at the provider: the connection's
            // own route, as `auth-method sso enable` reports it.
            callback_uri: callbackUriFor(issuer, slug),
            client_id_variable: outcome
              ? { variable: credentialVariables(slug).clientId, published: outcome.clientId }
              : null,
            secret: outcome
              ? { variable: outcome.secret.name, published: outcome.secret.published }
              : null,
          };
        }),
        // What setup's first deploy published, or null when there was none:
        // a dry run, or a deploy that failed, which is a warning.
        deployment:
          deployment === undefined
            ? null
            : {
                release_id: deployment.releaseId,
                content_hash: deployment.contentHash,
                deployment_id: deployment.deploymentId,
                origins: [...deployment.origins],
              },
      },
      next: {
        actions: [
          ...deployStep.actions,
          ...installOutcome.nextActions,
          brandingGuidanceAction(this.cliVersion),
          ...consoleStep.actions,
          ...ssoStep.actions,
          ...claimNudge.actions,
        ],
        // A JSON run prints no warnings, so a credential the project never
        // received would otherwise appear only as a `published` status with
        // nothing to act on. `auth-method sso enable` reports the same recovery step.
        commands: [
          ...republishCommands(
            answers.sso.flatMap((answer) => {
              const slug = providerOf(answer.selection).slug;
              const outcome = ssoOutcomes.get(slug);
              return [
                {
                  name: credentialVariables(slug).clientId,
                  secret: false,
                  published: outcome?.clientId,
                },
                {
                  name: outcome?.secret.name,
                  secret: true,
                  published: outcome?.secret.published,
                },
              ];
            }),
            this.cliVersion,
            recoverySelector(flags.cwd),
          ),
          ...deployStep.commands,
          ...installOutcome.nextCommands,
          ...consoleStep.commands,
          ...ssoStep.commands,
          ...claimNudge.commands,
        ],
      },
      pretty: prose(""),
      nextShown,
    });
  }

  /**
   * The hint for a default configuration that was not all written.
   *
   * @remarks
   * The cause knows its own remedy when it has one: a file setup declined to
   * touch is fixed by deciding what to do with that file, not by rerunning
   * with --force. When setup removed the new app it made, that is said first
   * either way, since the developer would otherwise look for an app that is
   * gone.
   *
   * @param cause - What stopped the write.
   * @param removedNewApp - Whether setup removed the new app it made.
   * @returns The hint to show.
   */
  private configurationFailureHint(cause: ZitadelError, removedNewApp: boolean): string {
    if (removedNewApp) {
      const removed =
        "The project was created but its default configuration (schema, login flow, " +
        "password policy) was not all written, so setup removed the new app again.";
      if (cause.hint !== undefined) {
        return `${removed} ${cause.hint}`;
      }
      return `${removed} Re-run setup as before to start over.`;
    }
    if (cause.hint !== undefined) {
      return cause.hint;
    }
    return (
      "The project was created but its default configuration (schema, login flow, " +
      "password and sign-up policies) was not all written. Re-run `zitadel setup` to start over; " +
      "--force overwrites the schema and flow files setup scaffolds and keeps an " +
      "existing password or sign-up policy file. It does not cover a connection under .zitadel/idps/ -- those are " +
      "yours, so setup never replaces or removes one; delete it to scaffold a fresh " +
      "one, or keep it and enable the provider after setup to reuse it."
    );
  }

  /**
   * Whether the server takes a sign-up policy.
   *
   * @remarks
   * Asked by evaluating one with no settings, which stores nothing. The CLI's
   * own client accepted the body, so a server refusing it as malformed does
   * not know the operation yet. Any other failure says nothing about the
   * policy and is left for the deploy to report.
   *
   * @param server - The server's base URL.
   * @param project - The project just created, with the secret to ask as.
   * @returns False when the server refuses the operation as unknown.
   */
  private async serverTakesSignupPolicy(server: string, project: CreatedProject): Promise<boolean> {
    const service = new PolicyService(
      createZitadelClient({
        userAgent: userAgent(),
        baseUrl: server,
        token: project.project_secret,
        signal: this.signal,
      }),
      project.id,
    );
    try {
      await service.evaluate({
        operation: SignupPolicy.OPERATION,
        config: {},
        input: { solved_challenge: "zitadel_pow" },
      });
      return true;
    } catch (error) {
      return !(error instanceof InvalidError && error.serverCode === "req.invalid");
    }
  }

  /**
   * Write the project's default configuration under `.zitadel/`, and a README
   * into each of its directories, all through the configuration library.
   *
   * @remarks
   * Only files: the first deploy publishes them. The configuration is planned
   * again against what is on disk now, so it refuses what the plan before the
   * project was created would. A README already there is the developer's, and
   * is kept even under `--force`. The first deploy carries every policy file,
   * so a server that does not take the sign-up policy yet gets none: setup
   * goes on without it. A file `--force` keeps stays, and the server refuses
   * every deploy that carries it.
   *
   * @param answers - What to scaffold.
   * @param project - The project just created, whose server is asked whether
   *   it takes a sign-up policy.
   * @returns The absolute paths written, and the minimum password length the
   *   policy holds.
   * @throws {@link ZitadelError} With `E_CONFLICT` when a file setup will not
   *   replace is there, or `E_VALIDATION` when a policy `--force` keeps is not
   *   valid.
   */
  private async writeConfiguration(
    answers: SetupAnswers,
    project: CreatedProject,
  ): Promise<ScaffoldedConfiguration> {
    const signupPolicy = await this.serverTakesSignupPolicy(answers.server, project);
    const scaffold = await scaffoldOf(this.cwd, this.force, answers, signupPolicy);
    if (!signupPolicy) {
      reportWarning(
        scaffold.signupPolicy === undefined
          ? `The server does not take a sign-up policy yet, so setup wrote none. Upgrade the server, then add ${SignupPolicy.PATH} and run \`zitadel deploy\`.`
          : `The server does not take a sign-up policy yet, so every \`zitadel deploy\` fails while ${SignupPolicy.PATH} is there. Upgrade the server, or move the file out of ${CONFIG_DIRECTORIES.policies}/ until you do.`,
      );
    }
    const store = new DiskStore(this.cwd);
    const saved = await scaffold.change
      .save(store, {
        overwrite: this.force,
        createOnly: (document) => {
          return document instanceof Connection;
        },
      })
      .catch((error: unknown) => {
        throw setupRefusal(error, scaffold.connections);
      });
    const readmes = await Promise.all(
      [
        { directory: CONFIG_DIRECTORIES.schemas, text: schemasReadmeContent() },
        { directory: CONFIG_DIRECTORIES.flows, text: flowsReadmeContent() },
        { directory: CONFIG_DIRECTORIES.policies, text: policiesReadmeContent() },
      ].map(async (readme): Promise<readonly string[]> => {
        const path = `${readme.directory}/${README}`;
        const text = normalizePublicCliProse(readme.text, this.cliVersion);
        try {
          await store.writeText(path, text, "create");
          return [path];
        } catch (error) {
          if (error instanceof FileExistsError) {
            return [];
          }
          throw error;
        }
      }),
    );
    return {
      filesWritten: [...saved, ...readmes.flat()].map((path) => {
        return join(this.cwd, path);
      }),
      passwordMinLength: scaffold.policy.minLength ?? null,
    };
  }

  /**
   * Put the scaffolded project under version control, unless it already is or
   * `--no-git` said not to. Narrated but never fatal: without the commit the
   * first release simply records no provenance, which is what setup did before.
   */
  private async makeInitialCommit(
    cwd: string,
    dryRun: boolean,
    enabled: boolean,
  ): Promise<InitialCommitOutcome> {
    if (!enabled) {
      return { kind: "skipped" };
    }
    if (dryRun) {
      consola.info("Would initialise a git repository and commit the scaffolded project (dry run)");
      return { kind: "skipped" };
    }
    const outcome = await ensureInitialCommit(cwd);
    if (outcome.kind === "created" || outcome.kind === "committed") {
      consola.success(`Committed the project as ${outcome.sha.slice(0, 7)}`);
      // git guesses an author from the machine when none is configured and
      // commits anyway, so the commit exists but carries a name the developer
      // did not choose. Said out loud, with the one command that fixes it.
      if (outcome.invented) {
        reportWarning(
          "git could build no author identity on this machine, so the commit was made as " +
            "Zitadel Setup <setup@zitadel.local>. Set user.name and user.email, then run " +
            "`git commit --amend --reset-author` to put your own name on it.",
        );
      } else if (outcome.guessedIdentity) {
        reportWarning(
          "This machine has no git user.name/user.email, so git guessed the author from your " +
            "username and hostname. Set your identity and run `git commit --amend --reset-author` " +
            "to put your own name on the commit.",
        );
      }
    }
    if (outcome.kind === "unavailable") {
      reportWarning(unavailableWarning(outcome));
    }
    return outcome;
  }

  /**
   * Deploy `.zitadel/` to the project setup just created, to its primary
   * origin. Narrated but never fatal: the app is scaffolded and committed, and
   * a failure leaves the deploy one command away.
   */
  private async deployScaffoldedProject(opts: {
    cwd: string;
    server: string;
    project: CreatedProject;
    dryRun: boolean;
    selector: EnvironmentSelector;
  }): Promise<InitialDeployment | undefined> {
    if (opts.dryRun) {
      consola.info("Would deploy .zitadel/ to the project (dry run)");
      return undefined;
    }
    consola.start("Deploying .zitadel/ to the project");
    try {
      const deployment = await deployInitialRelease({
        client: createZitadelClient({
          userAgent: userAgent(),
          baseUrl: opts.server,
          token: opts.project.project_secret,
          signal: this.signal,
        }),
        projectId: opts.project.id,
        cwd: opts.cwd,
        env: this.env,
        json: this.isJson,
        color: this.isColored,
        message: INITIAL_DEPLOY_MESSAGE,
        suggest: (args) => projectCommand(args, opts.selector, this.cliVersion),
      });
      consola.success(
        `Deployed ${deployment.contentHash} to ${deployment.origins.length} origin${deployment.origins.length === 1 ? "" : "s"}`,
      );
      return deployment;
    } catch (error) {
      reportWarning(
        `The project was set up but its first deploy failed: ${toZitadelError(error).message}. Run \`zitadel ${DEPLOY_ARGS}${opts.selector}\` to publish .zitadel/.`,
      );
      return undefined;
    }
  }

  /**
   * `setup --dev-port <n>` on an app setup already patched: moves the app to
   * the new port (see {@link moveDevPort}) instead of skipping the directory.
   */
  private async moveToDevPort(
    cwd: string,
    typedCwd: string | undefined,
    devPort: number,
    dryRun: boolean,
  ): Promise<JsonEnvelope> {
    const config = await readZitadelConfig(cwd);
    const server = readProjectServer(config);
    consola.start(`Moving the app to ${issuerFromPort(devPort)}${dryRun ? " (dry run)" : ""}`);
    const move = await moveDevPort({
      cwd,
      devPort,
      source: server,
      orca: createOrca(),
      cliVersion: this.cliVersion,
      dryRun,
      signal: this.signal,
      consent: (gate) => this.consent(gate),
    });
    for (const file of move.result.filesWritten) {
      consola.info(`${dryRun ? "Would update" : "Updated"} ${relativeDisplay(cwd, file)}`);
    }
    // Pinned to the project just moved, as the other recoveries are: its env
    // file, or the server the move used for a project setup gave none, never
    // what the shell has exported.
    const selector = (await access(join(cwd, ".env.development.local")).then(
      () => true,
      () => false,
    ))
      ? recoverySelector(typedCwd)
      : environmentSelectorSuffix({ server, cwd: typedCwd });
    // Not setup again: the app is on the new port by now, so a rerun moves
    // nothing and never reaches the old origin.
    const cleanup =
      move.refused && move.staleOrigin !== undefined
        ? projectCommand(
            `origin rm ${Cmd.quote(move.staleOrigin)} --force`,
            selector,
            this.cliVersion,
          )
        : undefined;
    // The new origin serves nothing until a deployment names it.
    const deploy =
      move.undeployed === undefined
        ? undefined
        : projectCommand(DEPLOY_ARGS, selector, this.cliVersion);
    if (deploy !== undefined) {
      reportWarning(
        `${move.issuer} serves nothing until the next deploy: ${move.undeployed}. Run \`${deploy}\`.`,
      );
    }
    if (move.staleOrigin !== undefined) {
      reportWarning(
        `${move.staleOrigin} is still among the project's origins; it admits a port nothing serves any more.${cleanup === undefined ? "" : ` Remove it with \`${cleanup}\`.`}`,
      );
    }
    for (const slug of move.ssoProviders) {
      reportWarning(
        `Social sign-in with ${slug} redirects to the old port: add ${callbackUriFor(move.issuer, slug)} as a redirect URI at the provider.`,
      );
    }
    const moved = move.previousIssuer !== move.issuer;
    if (moved) {
      consola.success(`Moved from ${move.previousIssuer} to ${move.issuer}`);
    } else {
      consola.success(`Already on ${move.issuer}`);
    }

    return this.emit({
      status: "ok",
      data: {
        title: moved ? `Moved the app to ${move.issuer}.` : `The app is already on ${move.issuer}.`,
        moved,
        previous_issuer: move.previousIssuer,
        issuer: move.issuer,
        dev_port: devPort,
        files_written: move.result.filesWritten.map((file) => relativeDisplay(cwd, file)),
        deployment_id: move.deploymentId ?? null,
      },
      next: {
        actions: [`Restart the dev server and open ${move.issuer}/login.`],
        ...(deploy === undefined && cleanup === undefined
          ? {}
          : { commands: [deploy, cleanup].filter((command) => command !== undefined) }),
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
    "Could not detect a supported app framework, and this directory is not empty",
    {
      hint:
        `${target.reason ?? "Directory is not empty."} ` +
        "Pass --force to scaffold into this non-empty directory, run setup from an empty directory, or run setup from an existing supported app project.",
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
  guidance: { retry: SetupRetryOptions; serverFlag?: string; cliVersion: string; ask: Asker },
): Promise<string> {
  if (framework) {
    return framework;
  }
  if (nonInteractive) {
    // Most often a coding agent or CI: no terminal, and no flag saying so. So
    // the error names every choice instead of pointing at a prompt it can't
    // see, and for a local server hands over the exact rerun. Only then:
    // `setupRetryFlags` pins `--server local`.
    const choices = orca.availableFrameworks().map((choice) => choice.id);
    const suggested = choices.includes("next") ? "next" : choices[0];
    throw new ZitadelError("E_FRAMEWORK_NOT_DETECTED", "Empty directory — pass --framework", {
      hint: (
        "Setup asks which framework to scaffold only in a terminal. Without one, or with " +
        `--json or --non-interactive, pass --framework with one of: ${choices.join(", ")}.`
      ).trimEnd(),
      nextCommands:
        guidance.serverFlag === "local" && suggested
          ? [
              unscopedCommand(
                `setup ${setupRetryFlags({ ...guidance.retry, framework: suggested })}`,
                guidance.cliVersion,
              ),
            ]
          : [],
      details: { frameworks: choices },
    });
  }
  return new PickFrameworkPrompt().ask(orca.availableFrameworks(), guidance.ask);
}

/**
 * Whether a local server hosts the platform plane, i.e. whether a claim
 * started against it can actually complete. `platform.bootstrap_project`
 * pins the deployment's default project to the well-known proj_platform, and
 * the console runtime document publishes that resolution, so one public GET
 * answers the question. Fail closed: an unreadable, absent, or hanging
 * document means no nudge, never a nudge into a flow that would 401 at
 * claim/complete — the timeout mirrors checkLocalServerHealth so a socket
 * that accepts and stalls cannot hang setup after the real work is done.
 * Exported so the fail-closed behavior is testable without a live server.
 */
export async function localServerHostsPlatform(server: string, timeoutMs = 1500): Promise<boolean> {
  return Boolean(await readPlatformRuntime(server, timeoutMs));
}

/**
 * Removes a new app setup scaffolded but could not finish setting up, and puts
 * back what the directory held. A failure to do so is reported, not thrown:
 * the error that stopped setup is the one the developer needs.
 */
async function removeNewApp(
  newApp: UndoableScaffold,
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  try {
    await newApp.undo();
    consola.info(`Removed the new app, so ${shortPath(cwd, env)} holds what it did before setup`);
  } catch (error) {
    reportWarning(
      `Could not remove the new app setup scaffolded in ${cwd}: ${toZitadelError(error).message}`,
    );
  }
}

/**
 * Removes `zitadel.json` (the marker the already-initialized guard skips on)
 * and `.zitadel/secret`, so a setup that failed after writing them can be rerun.
 */
async function removeSetupMarkers(cwd: string): Promise<void> {
  await rm(join(cwd, "zitadel.json"), { force: true });
  await rm(join(cwd, ".zitadel/secret"), { force: true });
}

/**
 * The name of the README setup writes into each configuration directory.
 */
const README = "README.md";

/**
 * What setup's default configuration left behind.
 */
type ScaffoldedConfiguration = {
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
async function scaffoldOf(
  cwd: string,
  force: boolean,
  answers: Pick<SetupAnswers, "preset" | "useCase" | "sso" | "passwordMinLength">,
  signupPolicy = true,
): Promise<Scaffold<SsoDraft>> {
  try {
    // Read without refusing a broken file: the scaffold knows which paths it
    // would write, so it alone decides whether a broken default is replaced
    // (`force`) or refused, and any other broken file is left to the deploy.
    // Only the kinds it scaffolds or plans around: branding is never written,
    // so an unreadable branding file does not stand in setup's way.
    const config = await ZitadelConfig.loadKinds(new DiskStore(cwd), [
      "schemas",
      "flows",
      "connections",
      "policies",
    ]);
    return config.scaffold({
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
function setupRefusal(error: unknown, connections: readonly ScaffoldedConnection[]): unknown {
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
    nextCommands: [unscopedCommand(ssoEnableArgs(selection))],
    details: { file: path },
  });
}

/** A deterministic stand-in project for `--dry-run`, so no remote call is made. */
function dryRunProject(issuer: string): CreatedProject {
  return {
    id: "dry-run-0000",
    name: "dry-run",
    project_secret: "sk_proj_dry_run_full",
    preview_secret: "sk_proj_dry_run_preview",
    origins: [{ pattern: issuer, kind: "primary" }],
    created_at: "2026-04-21T14:03:11.000Z",
  };
}

/** What a command line describing a custom connection looks like, for an error to show. */
const SSO_CUSTOM_EXAMPLE = customExample(SETUP_FLAG_NAMES);

/**
 * The env files the patch merges a project's id and secrets into: `.env.local`
 * for the app, and `.env.development.local`, which the recovery commands pin
 * with `--env-file` and which therefore decides which project they target.
 */
const CREDENTIAL_ENV_FILES = [".env.local", ".env.development.local"] as const;

/**
 * What each credential env file holds, or `undefined` for a file that is not
 * there. Only a missing file counts as absent: any other read error is
 * rethrown, because reading it as "absent" would make the rollback delete a
 * pre-existing file it should have restored.
 */
export async function readCredentialEnvFiles(
  cwd: string,
): Promise<Map<string, Buffer | undefined>> {
  const before = new Map<string, Buffer | undefined>();
  for (const file of CREDENTIAL_ENV_FILES) {
    try {
      before.set(file, await readFile(join(cwd, file)));
    } catch (error) {
      if (!isErrno(error, "ENOENT")) {
        throw error;
      }
      before.set(file, undefined);
    }
  }
  return before;
}

/**
 * Puts the credential env files back to what {@link readCredentialEnvFiles}
 * read before the patch, and removes one setup created. The patch merged the
 * failed setup's project id and secrets into them, and a merge only adds the
 * keys a file is missing, `--force` or not: left in place, they would survive
 * the rerun, and the app would talk to an abandoned project with no schema or
 * login flow. `.env.example` needs nothing: it gets the same empty values on
 * every run.
 *
 * A file that cannot be restored is reported as a warning rather than thrown:
 * this runs while setup is already failing, and the real error carries the
 * remedy the developer needs.
 */
export async function restoreCredentialEnvFiles(
  cwd: string,
  before: ReadonlyMap<string, Buffer | undefined>,
): Promise<void> {
  for (const [file, content] of before) {
    const path = join(cwd, file);
    try {
      if (content === undefined) {
        await rm(path, { force: true });
      } else {
        await writeFile(path, content);
      }
    } catch (error) {
      const reason = errorMessage(error);
      reportWarning(
        `Could not restore ${file} after the failed setup (${reason}); it may still name the abandoned project.`,
      );
    }
  }
}

/**
 * The provider a scripted run asked for, or `undefined` when it asked for
 * none — in which case the wizard's question decides.
 *
 * The client id is required alongside the provider rather than prompted for:
 * a run that named a provider on the command line is scripted, and stopping
 * to ask would hang it.
 *
 * The secret is never a flag, following `variable set`: it cannot reach
 * shell history, a process listing or a CI log. Only a scripted run reads it
 * from stdin — an interactive one is asked, and consuming stdin there would
 * leave the wizard's own prompts reading a stream already at EOF. A terminal
 * on stdin means nothing was piped, and reading it would block forever, so
 * that case is treated as "not supplied".
 */
export async function ssoFromFlags(
  flags: {
    sso?: string;
    ssoClientId?: ClientId;
    ssoSlug?: string;
    ssoDisplayName?: string;
    ssoIssuer?: string;
    ssoScopes?: string;
  },
  nonInteractive: boolean,
  dryRun: boolean,
  ask: Asker,
  cliVersion: string,
): Promise<SsoDraft | undefined> {
  const customValues = customSettingsOf(flags);
  if (flags.sso === undefined) {
    return undefined;
  }
  // Described before the credentials are asked for, and before a Project is
  // created: a name or issuer the server would refuse is a mistake in the
  // command line.
  // An interactive run asks for the custom settings it was not given, the way
  // it asks for a client id: `--sso` skips the question it answers and no other.
  const selection = selectionFromFlags(
    flags.sso,
    flags.sso === CUSTOM_PROVIDER && !nonInteractive
      ? await askCustomSettings(customValues, ask)
      : customValues,
    SETUP_FLAG_NAMES,
    SSO_CUSTOM_EXAMPLE,
  );
  const loopback = loopbackIssuerWarning(selection);
  if (loopback !== undefined) {
    reportWarning(loopback);
  }
  if (flags.ssoClientId === undefined) {
    return { selection, credentials: {} };
  }
  if (!nonInteractive || dryRun) {
    // The wizard asks for the secret, the way it asks for a client id that
    // `--sso-client-id` did not answer. A preview publishes nothing and
    // materialises nothing, so demanding a real credential to see what setup
    // would do is a toll for no reason -- and `auth-method sso enable --dry-run`
    // returns before asking for one at all.
    return { selection, credentials: { clientId: flags.ssoClientId } };
  }
  // Required, not optional: scaffolding the connection without it writes a
  // sign-in button that fails at the provider with `invalid_client`, long
  // after setup reports success. It is never a flag — that would put it in
  // shell history, a process listing and CI logs.
  const secret = await ask({
    kind: "secret",
    name: "client secret",
    message: `What is the client secret of your ${providerOf(selection).displayName} OAuth app?`,
    parse: parseClientSecret,
    stdin: true,
    // A concrete rerun for an agent, never carrying the value: the secret is
    // piped from the caller's own environment.
    retry: inShell(
      unscopedCommand(`setup --sso ${flags.sso} --sso-client-id <id> ...`, cliVersion),
      { before: `printf '%s' "$CLIENT_SECRET" | ` },
    ),
  });
  return { selection, credentials: { clientId: flags.ssoClientId, secret } };
}

/**
 * How the connection's credentials reach the project just created.
 *
 * `undefined` when there is no project behind the run — `--server mock`
 * answers from fixtures and has no variables to write. The freshly minted
 * project credentials are used directly: setup has them in hand and nothing
 * has been claimed yet, so there is no owner for the developer to name.
 */
function ssoCredentialPublisher(
  server: string,
  project: CreatedProject,
  signal: AbortSignal,
): SecretPublisher | undefined {
  if (server === "mock") {
    return undefined;
  }
  const client = createZitadelClient({
    userAgent: userAgent(),
    baseUrl: server,
    token: project.project_secret,
    signal,
  });
  const variableService = new VariableService(client, project.id);
  return async (name, value, { secret }) => {
    await variableService.set(
      name,
      value,
      VariableWrite.of({
        secret,
        preview: false,
      }),
    );
  };
}

async function createProjectWithLocalHint(
  client: ReturnType<typeof createZitadelClient>,
  server: string,
  cliVersion: string,
  projectName: string,
  issuer: string,
  retry: SetupRetryOptions,
): Promise<CreatedProject> {
  const projectService = new ProjectService(client);
  try {
    // Register the app's own origin as primary: only a primary pattern admits
    // the requests the dev proxy forwards from it, and a deploy goes to the
    // project's primary origins. A preview pattern is for the URLs a
    // pull-request build deploys to, which this is not.
    return await projectService.create({
      name: projectName,
      origins: [{ pattern: issuer, kind: "primary" }],
      seed_defaults: false,
    });
  } catch (error) {
    const normalized = toZitadelError(error);
    const retryFlags = setupRetryFlags(retry);
    const sso = ssoRecovery(retry, cliVersion);
    throw new ZitadelError(normalized.code, normalized.message, {
      hint:
        `${normalized.hint ? `${normalized.hint} ` : ""}` +
        "If you meant to use a local Zitadel server, start it first " +
        `and retry setup with ${retryFlags}. ${sso.hint}`.trimEnd(),
      nextCommands: [
        unscopedCommand(`start${cwdArg(retry)}`, cliVersion),
        unscopedCommand(`setup ${retryFlags}`, cliVersion),
        ...sso.commands,
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

/**
 * Replaces the user's `$HOME` with `~` in a path for compact terminal output.
 * Falls back to the raw path when `HOME` isn't set or doesn't match. The
 * environment is the run's, not the process's, so a run told what its
 * environment is reads the same one everywhere.
 */
function shortPath(absolute: string, env: NodeJS.ProcessEnv): string {
  const home = env.HOME;
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
 * What a run that cannot ask says about a taken app port, with the command
 * that moves the app to `free`. With no free port among the next ones it names
 * only the flag: a placeholder in a suggested command is a shell redirection.
 */
export function portInUseWarning(
  port: number,
  free: number | undefined,
  suggest: (args: string) => SuggestedCommand,
): string {
  return free === undefined
    ? `Port ${port} and the ports after it are already in use. If that is not this app's dev server, run setup with --dev-port and a free port.`
    : `Port ${port} is already in use. If that is not this app's dev server, run setup with a free port: ${suggest(`setup --dev-port ${free}`)}`;
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
 * Builds the section list driving {@link renderSummary} for the setup command.
 * Exported so its wording is unit-tested.
 */
export function buildSummary(opts: {
  projectFacts: Awaited<ReturnType<typeof detectProjectFacts>>;
  writtenRel: string[];
  depsAdded: ReadonlyArray<string>;
  project: CreatedProject;
  server: string;
  issuer: string;
  scaffoldedFramework: boolean;
  scaffoldedBesideFiles: boolean;
  connections: readonly ScaffoldedConnection[];
  signIn: SignIn;
}): Section[] {
  const {
    projectFacts,
    writtenRel,
    depsAdded,
    project,
    server,
    issuer,
    scaffoldedFramework,
    connections,
  } = opts;
  const packageJsonHit = pickWrittenFile(writtenRel, "package.json");

  const detected: Row[] = [{ label: "Framework", value: formatFrameworkLine(projectFacts) }];
  if (scaffoldedFramework) {
    detected.push({
      label: "Scaffold",
      value: opts.scaffoldedBesideFiles
        ? "new project over existing files (--force)"
        : "new project",
    });
  }

  const installedRows: Row[] = [];
  if (packageJsonHit && depsAdded.length > 0) {
    installedRows.push({
      label: "Package",
      value: depsAdded.join(", "),
      secondary: stylePath(fileNameOf(packageJsonHit)),
    });
  }
  // A union over every framework's scaffold artifacts: rows only render when
  // the patcher actually wrote the file, so entries for other frameworks are
  // inert. Suffixes are matched case-sensitively (src/App.tsx is React/Solid,
  // src/app.tsx is Qwik, app.vue is the Nuxt shell, src/App.vue is Vue).
  for (const [label, suffix] of [
    ["Home redirect", "app/page.tsx"],
    ["Login page", "app/login/page.tsx"],
    ["Register page", "app/register/page.tsx"],
    ["Profile page", "app/profile/page.tsx"],
    ["Request proxy", "proxy.ts"],
    ["Middleware", "middleware.ts"],
    ["App entry", "src/App.tsx"],
    ["App entry", "src/app.tsx"],
    ["App entry", "src/App.vue"],
    ["App entry", "src/App.svelte"],
    ["App entry", "src/app/app.ts"],
    ["Routes", "src/app/app.routes.ts"],
    ["Request proxy", "proxy.conf.cjs"],
    ["App shell", "app.vue"],
    ["Home redirect", "pages/index.vue"],
    ["Login page", "pages/login.vue"],
    ["Register page", "pages/register.vue"],
    ["Profile page", "pages/profile.vue"],
    ["Env vars", ".env.local"],
  ] as const) {
    const hit = pickWrittenFile(writtenRel, suffix);
    if (hit) {
      installedRows.push({ label, value: stylePath(hit) });
    }
  }
  // The Vite config merge carries the /__nextgen dev proxy; the file name
  // varies (ts/js/mts/mjs), so it can't ride the suffix table above.
  const viteConfigHit = writtenRel.find((file) => /(^|\/)vite\.config\.[cm]?[jt]s$/.test(file));
  if (viteConfigHit) {
    installedRows.push({ label: "Dev proxy", value: stylePath(viteConfigHit) });
  }

  // The login-customization entry points. These are what a user edits to
  // change what the login collects, how it authenticates and what it enforces —
  // burying them in the verbose per-file narration above the box means users
  // don't find them (each folder ships a README with the workflow).
  const customizeRows: Row[] = [];
  for (const [label, suffix, dir] of [
    ["User schema", DEFAULT_SCHEMA_CONFIG_PATH, CONFIG_DIRECTORIES.schemas],
    ["Login flow", DEFAULT_FLOW_CONFIG_PATH, CONFIG_DIRECTORIES.flows],
    ["Password policy", PasswordPolicy.PATH, CONFIG_DIRECTORIES.policies],
  ] as const) {
    const hit = pickWrittenFile(writtenRel, suffix);
    if (hit) {
      customizeRows.push({ label, value: stylePath(`${dir}/`), secondary: "see its README.md" });
    }
  }
  // One row per provider: each has its own connection file, and a developer
  // scanning the summary for where to edit needs the path that belongs to the
  // provider they are looking at.
  for (const entry of connections) {
    const provider = providerOf(entry.chosen.selection);
    customizeRows.push({
      label: "Social sign-in",
      value: provider.displayName,
      secondary: stylePath(entry.connection.path),
    });
    // A scripted `--sso` run asks nothing, so the prompt that announces the
    // URI never shows; the summary is where it reaches the developer then.
    customizeRows.push({
      label: "Redirect URI",
      value: styleUrl(callbackUriFor(issuer, provider.slug)),
    });
  }

  // What a user meets at sign-in, so a preset's name is not the only record of
  // it: `password-first` enables passkeys too, and profile fields are optional.
  const { signIn } = opts;
  const signInRows: Row[] = [
    { label: "Starts with", value: signIn.starts_with },
    { label: "Methods", value: signIn.methods.join(", ") },
    {
      label: "Registration",
      value: signIn.fields
        .map((field) => `${field.name}${field.required ? "" : " (optional)"}`)
        .join(", "),
    },
    {
      label: "Passwords",
      value:
        signIn.password_min_length === null
          ? "no minimum length"
          : `at least ${signIn.password_min_length} characters`,
    },
  ];

  const projectRows: Row[] = [
    { label: "Project id", value: styleId(project.id) },
    { label: "Server", value: styleUrl(server) },
    { label: "App will run", value: styleUrl(issuer) },
  ];

  return [
    { title: "Detected", rows: detected },
    { title: "Installed", rows: installedRows },
    { title: "Sign-in", rows: signInRows },
    { title: "Customize", rows: customizeRows },
    { title: "Project", rows: projectRows },
  ];
}
