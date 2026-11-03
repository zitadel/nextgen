import {
  DEFAULT_SETUP_PRESET,
  DEFAULT_SETUP_USE_CASE,
  type SetupPreset,
  type SetupUseCase,
} from "@zitadel/config/defaults";
import {
  CUSTOM_PROVIDER,
  IDP_PROVIDERS,
  type ProviderSelection,
  providerOf,
  selectionName,
} from "@zitadel/config/idp";
import {
  customFlagText,
  flagText,
  type CustomFlagValues,
  selectionFromFlags,
  SETUP_FLAG_NAMES,
  ssoEnableArgs,
} from "../../lib/idp";
import { environmentSelectorSuffix, projectEnvFile } from "../../lib/oclif/environment-flags";
import type { PasswordMinLength } from "../../lib/policies";
import { Cmd } from "../../lib/cmd";
import {
  type EnvironmentSelector,
  projectCommand,
  type SuggestedCommand,
} from "../../lib/suggestion";

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
