import {
  CUSTOM_PROVIDER,
  DEFAULT_SCOPES,
  type DisplayName,
  type Issuer,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseScopes,
  type ProviderSelection,
  RESERVED_SLUGS,
} from "@zitadel/config/idp";

import type { Questions } from "@/lib/ui";
import type { Connection, ConnectionSetting, UserSchema, ZitadelConfig } from "@/lib/zitadel";

import {
  type CustomFlagValues,
  customExample,
  customFlagValues,
  ENABLE_FLAG_KEYS,
  ENABLE_FLAG_NAMES,
  selectionFromFlags,
} from "./custom";

/**
 * The `auth-method sso enable` flags that name the provider and describe a
 * custom connection, by the names they are read as.
 */
export type ProviderFlags = {
  /**
   * The provider `--provider` names.
   */
  readonly provider?: string | undefined;

  /**
   * The custom connection's `--slug`.
   */
  readonly slug?: string | undefined;

  /**
   * The custom connection's `--display-name`.
   */
  readonly displayName?: string | undefined;

  /**
   * The custom connection's `--issuer`.
   */
  readonly issuer?: string | undefined;

  /**
   * The custom connection's `--scopes`.
   */
  readonly scopes?: string | undefined;
};

/**
 * Whether a person is there to ask for the settings left out.
 */
export type ProviderRun = {
  /**
   * True for a person at a terminal; false for a script, a dry run or
   * `--non-interactive`.
   */
  readonly interactive: boolean;
};

/**
 * What a custom connection is checked against while it is described: the
 * configuration the run read, and the schema it adds the provider to.
 */
export type ProviderTarget = {
  /**
   * The whole configuration as the run read it.
   */
  readonly config: ZitadelConfig;

  /**
   * The schema the run adds the provider to.
   */
  readonly schema: UserSchema;
};

/**
 * The settings an existing custom connection holds beyond its slug that a run
 * reusing it takes instead of asking for them, each held to the rules a typed
 * answer is.
 */
export type StoredSettings = {
  /**
   * The name shown on the sign-in button, or `undefined` when the run was
   * given one or no connection has the slug.
   */
  readonly displayName: DisplayName | undefined;

  /**
   * The provider's issuer, or `undefined` when the run was given one or no
   * connection has the slug.
   */
  readonly issuer: Issuer | undefined;
};

/**
 * The provider a run of `auth-method sso enable` adds: a catalog provider by
 * its name, or a custom connection described by flags and, at a terminal, by
 * the answers to what the flags left out.
 *
 * @remarks
 * Made from the flags before anything else is read, so a provider the flags
 * get wrong is refused first. A custom connection a person will be asked to
 * finish is described only once everything that can fail without an answer
 * has passed: being turned away after typing a secret would mean typing it
 * again.
 */
export class ProviderChoice {
  /**
   * The provider, or `undefined` for a custom connection a person will be
   * asked to finish.
   */
  readonly selection: ProviderSelection | undefined;

  /**
   * The custom connection's settings the flags gave.
   */
  readonly values: CustomFlagValues;

  /**
   * Hold what the flags said.
   *
   * @param selection - The provider, or `undefined` when a person finishes it.
   * @param values - The settings the flags gave.
   */
  private constructor(selection: ProviderSelection | undefined, values: CustomFlagValues) {
    this.selection = selection;
    this.values = values;
  }

  /**
   * What the flags say about the provider to add.
   *
   * @remarks
   * A person at a terminal is asked for the custom settings they left out,
   * but later: here the ones they did give are only checked. A script, a dry
   * run or `--non-interactive` is held to the flags and told which are
   * missing.
   *
   * @param flags - The provider and custom-connection flags the run was given.
   * @param run - Whether someone is there to ask for the settings left out.
   * @returns The choice, with no provider yet when a person will be asked for
   *   the rest.
   * @throws {@link ZitadelError} When the provider is unknown, a custom setting
   *   accompanies a catalog provider, or a script leaves out a custom
   *   connection's setting.
   */
  static fromFlags(flags: ProviderFlags, run: ProviderRun): ProviderChoice {
    const provider = String(flags.provider);
    const values = customFlagValues(flags, ENABLE_FLAG_KEYS);
    // Each setting was refused under its own flag on its way in, so a run that
    // will ask for the rest has nothing left to check: the settings that were
    // given are already good, and being turned away after typing a secret would
    // mean typing it again.
    const complete =
      values.slug !== undefined && values.displayName !== undefined && values.issuer !== undefined;
    if (provider === CUSTOM_PROVIDER && run.interactive && !complete) {
      return new ProviderChoice(undefined, values);
    }
    const example = customExample(ENABLE_FLAG_NAMES);
    const selection = selectionFromFlags(provider, values, ENABLE_FLAG_NAMES, example);
    return new ProviderChoice(selection, values);
  }

  /**
   * The provider, asking a person for the custom settings the flags left out.
   *
   * @param target - The configuration and schema a custom connection is
   *   checked against.
   * @param ask - How a question is asked: the running command's `this.ask`.
   * @returns The provider, checked.
   * @throws {@link ZitadelError} When a setting is refused.
   * @throws {@link ConfigError} When the slug names a connection that cannot
   *   be reused, or a flow would reject the provider.
   */
  async resolve(target: ProviderTarget, ask: Questions): Promise<ProviderSelection> {
    if (this.selection !== undefined) {
      return this.selection;
    }
    const settings = await this.askCustomSettings(target, ask);
    const example = customExample(ENABLE_FLAG_NAMES);
    return selectionFromFlags(CUSTOM_PROVIDER, settings, ENABLE_FLAG_NAMES, example);
  }

  /**
   * The connection settings the developer gave, which an existing connection
   * may not have: a custom connection's display name, and its scopes when
   * `--scopes` was passed. A catalog provider's settings are the catalog's.
   *
   * @param selection - The provider.
   * @returns The settings given.
   */
  givenSettings(selection: ProviderSelection): readonly ConnectionSetting[] {
    if (selection.kind === "catalog") {
      return [];
    }
    if (this.values.scopes !== undefined) {
      return ["display name", "scopes"];
    }
    return ["display name"];
  }

  /**
   * Read the settings an existing connection holds that a run reusing it takes
   * instead of asking for them.
   *
   * @remarks
   * A setting the flags gave is not read at all, so a stored value it
   * replaces is never refused. Scopes are left out: reusing a connection never
   * applies them.
   *
   * @param existing - The connection the slug names, if any.
   * @returns Each stored setting the run uses; `undefined` for one the flags
   *   gave, and for both when no connection has the slug.
   * @throws {@link NotOidcConnectionError} When the connection has no issuer,
   *   whatever issuer was given.
   * @throws {@link UnusableSettingError} When a stored setting the run would
   *   use cannot be used.
   */
  readStoredSettings(existing: Connection | undefined): StoredSettings {
    if (existing === undefined) {
      return { displayName: undefined, issuer: undefined };
    }
    existing.refuseNonOidc();
    const displayName = ProviderChoice.unlessGiven(this.values.displayName, () => {
      return existing.readUsableDisplayName();
    });
    const issuer = ProviderChoice.unlessGiven(this.values.issuer, () => {
      return existing.readUsableIssuer();
    });
    return { displayName, issuer };
  }

  /**
   * The settings of a custom connection, asking only for the ones not already
   * given.
   *
   * @remarks
   * The slug comes first because it decides the most: a connection that
   * already has it answers the rest from its file, and one that connects to
   * another issuer, or that a login flow would reject, is refused the moment
   * the slug is typed. A given value goes through the same parser as a typed
   * one.
   *
   * @param target - The configuration and schema the connection is checked
   *   against.
   * @param ask - How a question is asked.
   * @returns Every setting.
   * @throws {@link ConfigError} When the slug names a connection to another
   *   issuer, or a flow would reject the provider.
   */
  private async askCustomSettings(
    target: ProviderTarget,
    ask: Questions,
  ): Promise<Required<CustomFlagValues>> {
    const given = this.values;
    const slug = await ask.text({
      name: "connection name",
      message:
        "What would you like to call this connection? It is used in your configuration, for example acme-sso.",
      parse: (value) => {
        return parseConnectionSlug(value, RESERVED_SLUGS);
      },
      given: given.slug,
    });
    const existing = target.config.connections.resolveBySlug(slug, this.checkedIssuer);
    // A flow `deploy` would reject once it offers the slug is refused now,
    // before the rest of the connection is asked for.
    target.config.flows.resolveForSso(target.schema, slug);
    // An existing connection is described by its file, so nothing it already
    // holds is asked again; reuse never applies scopes, so they are not asked.
    const stored = this.readStoredSettings(existing);
    const displayName = await ask.text({
      name: "display name",
      message: "What name should the sign-in button show? For example Acme SSO.",
      parse: parseDisplayName,
      given: given.displayName ?? stored.displayName,
    });
    const issuer = await ask.text({
      name: "issuer",
      message: "What is the issuer URL of the provider?",
      parse: parseIssuer,
      given: given.issuer ?? stored.issuer,
    });
    const defaultScopes = DEFAULT_SCOPES.join(" ");
    const scopes = await ask.text({
      name: "scopes",
      message: "Which scopes should we request? Separate them with spaces.",
      parse: parseScopes,
      given: given.scopes ?? ProviderChoice.keptScopes(existing, defaultScopes),
      initialValue: defaultScopes,
    });
    return { slug, displayName, issuer, scopes: scopes.join(" ") };
  }

  /**
   * The issuer `--issuer` gave, once the platform's parser takes it.
   *
   * @returns The issuer, or `undefined` when none was given or it is refused.
   */
  private get checkedIssuer(): Issuer | undefined {
    if (this.values.issuer === undefined) {
      return undefined;
    }
    const parsed = parseIssuer(this.values.issuer);
    if (!parsed.ok) {
      return undefined;
    }
    return parsed.value;
  }

  /**
   * The scopes a reused connection is taken to keep, so a person is not asked
   * for scopes reuse would never apply.
   *
   * @param existing - The connection the slug names, if any.
   * @param defaultScopes - The scopes a new connection requests by default.
   * @returns The default scopes for a reused connection, or `undefined` for a
   *   new one, whose scopes are asked for.
   */
  private static keptScopes(
    existing: Connection | undefined,
    defaultScopes: string,
  ): string | undefined {
    if (existing === undefined) {
      return undefined;
    }
    return defaultScopes;
  }

  /**
   * A stored setting, read only when the flags did not give one.
   *
   * @typeParam T - What the stored setting parses to.
   * @param given - The setting as the flags gave it.
   * @param read - Reads the stored setting.
   * @returns The stored setting, or `undefined` when the flags gave one.
   */
  private static unlessGiven<T>(given: string | undefined, read: () => T): T | undefined {
    if (given !== undefined) {
      return undefined;
    }
    return read();
  }
}
