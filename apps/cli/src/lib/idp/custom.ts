import {
  CUSTOM_PROVIDER,
  type CustomOidcInput,
  IDP_PROVIDERS,
  isLoopbackIssuer,
  type Parsed,
  type ProviderSelection,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseProviderSelection,
  parseScopes,
  RESERVED_SLUGS,
  selectionName,
} from "@zitadel/config/idp";

import { ZitadelError } from "@/lib/errors";

/**
 * The settings that describe a custom connection, in the order a command line
 * spells them.
 */
export const CUSTOM_SETTINGS = ["slug", "displayName", "issuer", "scopes"] as const;

/**
 * One setting that describes a custom connection.
 */
export type CustomSetting = (typeof CUSTOM_SETTINGS)[number];

/**
 * Everything a command's custom-connection flags say: the provider, then each
 * setting.
 */
type FlagSetting = "provider" | CustomSetting;

/**
 * What the developer typed for a custom connection, before it is checked.
 */
export type CustomFlagValues = { readonly [S in CustomSetting]?: string };

/**
 * How a setting is spelled on the command line, so a message names the flag to fix.
 */
export type CustomFlagNames = { readonly [S in FlagSetting]: string };

/**
 * The flag key a command defines for each setting, without its dashes.
 */
type FlagKeys = { readonly [S in FlagSetting]: string };

/**
 * The flag keys `auth-method sso enable` defines for a custom connection.
 *
 * @remarks
 * Each command builds its flag definitions from these, reads its parsed flags
 * through them, and the names a message suggests come from them, so renaming
 * one renames the flag, what is read from it, and what is suggested.
 */
export const ENABLE_FLAG_KEYS = {
  provider: "provider",
  slug: "slug",
  displayName: "display-name",
  issuer: "issuer",
  scopes: "scopes",
} as const satisfies FlagKeys;

/**
 * The `--sso-*` flag keys `setup` defines for the same settings.
 */
export const SETUP_FLAG_KEYS = {
  provider: "sso",
  slug: "sso-slug",
  displayName: "sso-display-name",
  issuer: "sso-issuer",
  scopes: "sso-scopes",
} as const satisfies FlagKeys;

/**
 * The flags a command defines, as a message spells them.
 *
 * @param keys - The flag keys the command defines.
 * @returns Each key with its leading dashes.
 */
function flagNamesOf(keys: FlagKeys): CustomFlagNames {
  return {
    provider: `--${keys.provider}`,
    slug: `--${keys.slug}`,
    displayName: `--${keys.displayName}`,
    issuer: `--${keys.issuer}`,
    scopes: `--${keys.scopes}`,
  };
}

/**
 * The flags on `auth-method sso enable`, which a failed setup suggests running instead.
 */
export const ENABLE_FLAG_NAMES: CustomFlagNames = flagNamesOf(ENABLE_FLAG_KEYS);

/**
 * The `--sso-*` flags on `setup` that describe the same settings.
 */
export const SETUP_FLAG_NAMES: CustomFlagNames = flagNamesOf(SETUP_FLAG_KEYS);

/**
 * A flag key as the parsed flags carry it: a command declares `display-name`
 * and reads `displayName`.
 *
 * @remarks
 * The rule is `src/lib/oclif/names.ts`, repeated here because this library
 * knows nothing of the command layer.
 */
type AsRead<Key extends string> = Key extends `${infer Head}-${infer Tail}`
  ? `${Head}${Capitalize<AsRead<Tail>>}`
  : Key;

/**
 * The parsed flags that carry a custom connection's settings, by the keys a
 * command defines.
 */
type ParsedCustomFlags<K extends FlagKeys> = {
  readonly [P in AsRead<K[CustomSetting]>]?: string;
};

/**
 * A flag key as the parsed flags carry it, at run time.
 *
 * @param key - The key as the command declares it.
 * @returns The key with each dash or underscore folded into a capital.
 */
function asRead(key: string): string {
  return key.replace(/[-_](.)/g, (_separator, letter: string) => {
    return letter.toUpperCase();
  });
}

/**
 * What a command's parsed flags say about a custom connection.
 *
 * @remarks
 * Typed by the keys, so the flags a command parsed must carry them. They are
 * read through a plain record, because which property a key names is only
 * known once the key is spelled at run time.
 *
 * @param flags - The command's parsed flags.
 * @param keys - The flag keys the command defines.
 * @returns Each setting the flags gave.
 */
export function customFlagValues<K extends FlagKeys>(
  flags: ParsedCustomFlags<K>,
  keys: K,
): CustomFlagValues {
  const byName: { readonly [name: string]: unknown } = flags;
  const read = (setting: CustomSetting): string | undefined => {
    const value = byName[asRead(keys[setting])];
    if (typeof value === "string") {
      return value;
    }
    return undefined;
  };

  return {
    slug: read("slug"),
    displayName: read("displayName"),
    issuer: read("issuer"),
    scopes: read("scopes"),
  };
}

/**
 * How the target server reaches this machine's loopback: `allowed` for a
 * server `zitadel start` runs as a process with the loopback allow list,
 * `container` for one it runs in Docker, `unknown` for any other.
 */
export const LOOPBACK_REACHES = ["allowed", "container", "unknown"] as const;

/**
 * How the target server reaches this machine's loopback.
 */
export type LoopbackReach = (typeof LOOPBACK_REACHES)[number];

/**
 * The warning a loopback issuer earns on a server that cannot reach it.
 *
 * @param selection - The provider the run adds.
 * @param reach - How the target server reaches this machine's loopback.
 * @returns The warning, or `undefined` when the issuer is reachable or not on
 *   this machine.
 */
export function loopbackIssuerWarning(
  selection: ProviderSelection,
  reach: LoopbackReach = "unknown",
): string | undefined {
  if (selection.kind !== "custom") {
    return undefined;
  }
  const issuer = selection.connection.issuer;
  if (!isLoopbackIssuer(issuer) || reach === "allowed") {
    return undefined;
  }
  if (reach === "container") {
    return `${issuer} is on this machine, but the local server runs in Docker, where localhost is the container itself, so sign-in will fail. Start the local server with its binary runtime instead.`;
  }

  return `${issuer} is on this machine, and a server blocks requests to localhost unless NEXTGEN_HTTPCLIENT_ALLOW_LIST allows it, so sign-in will fail until it does. A local server the CLI starts allows it by default.`;
}

/**
 * What a command line describing a custom connection looks like, spelled with
 * the flags the command defines, for an error or a help example to show.
 *
 * @param flag - How the command spells each flag.
 * @param withScopes - Whether the example names the scopes too.
 * @returns The example arguments.
 */
export function customExample(flag: CustomFlagNames, withScopes = false): string {
  const described = [
    `${flag.provider} ${CUSTOM_PROVIDER}`,
    `${flag.slug} acme-sso`,
    `${flag.displayName} 'Acme SSO'`,
    `${flag.issuer} https://sso.acme.example`,
  ];
  if (withScopes) {
    return [...described, `${flag.scopes} 'openid profile email groups'`].join(" ");
  }

  return described.join(" ");
}

/**
 * The names of the custom settings that were given, as the command spells them.
 *
 * @param values - The settings the flags gave.
 * @param flag - How the command spells each flag.
 * @returns The flags that carried a value, in command-line order.
 */
export function givenCustomFlags(
  values: CustomFlagValues,
  flag: CustomFlagNames,
): readonly string[] {
  return CUSTOM_SETTINGS.filter((setting) => {
    return values[setting] !== undefined;
  }).map((setting) => {
    return flag[setting];
  });
}

/**
 * One setting's value, or its complaint under the flag that carried it.
 *
 * @param name - The flag, as the command spells it.
 * @param parsed - What the platform's parser made of the value.
 * @returns The parsed value.
 * @throws {@link ZitadelError} With `E_VALIDATION` naming the flag when the
 *   parser refused the value.
 */
function checkedUnder<T>(name: string, parsed: Parsed<T>): T {
  if (!parsed.ok) {
    throw new ZitadelError("E_VALIDATION", `${name}: ${parsed.problem}`, {
      hint: `Fix ${name} and run the command again.`,
      details: { flag: name },
    });
  }

  return parsed.value;
}

/**
 * Check the settings that were given, and only those, naming the flag that
 * carried a bad one.
 *
 * @remarks
 * For a run that will ask for the rest: a slug the server would refuse is
 * refused before the first question, as a missing client id is.
 *
 * @param values - The settings the flags gave.
 * @param flag - How the command spells each flag.
 * @throws {@link ZitadelError} With `E_VALIDATION` naming the first flag whose
 *   value the platform refuses.
 */
export function checkGivenCustomFlags(values: CustomFlagValues, flag: CustomFlagNames): void {
  if (values.slug !== undefined) {
    checkedUnder(flag.slug, parseConnectionSlug(values.slug, RESERVED_SLUGS));
  }
  if (values.displayName !== undefined) {
    checkedUnder(flag.displayName, parseDisplayName(values.displayName));
  }
  if (values.issuer !== undefined) {
    checkedUnder(flag.issuer, parseIssuer(values.issuer));
  }
  if (values.scopes !== undefined) {
    checkedUnder(flag.scopes, parseScopes(values.scopes));
  }
}

/**
 * The provider a command line names, with its settings checked as a whole.
 *
 * @remarks
 * A catalog provider is just its name. A custom one is described by the
 * settings that follow it, each checked against the contract the server
 * enforces on apply. Every complaint is raised here, so a caller that wants a
 * mistake named before a secret is asked for calls it before asking: being
 * turned away after typing a credential would mean typing it again. The
 * settings are flags on purpose — a name, issuer and scopes are what a script
 * or an agent supplies, and what a person can read back from their shell
 * history.
 *
 * @param provider - The provider the command line names.
 * @param values - The settings the flags gave.
 * @param flag - How the command spells each flag.
 * @param example - A complete command line, for the refusal of an incomplete one.
 * @returns The provider, checked.
 * @throws {@link ZitadelError} With `E_VALIDATION` when a setting accompanies a
 *   catalog provider, the provider is unknown, a custom connection lacks a
 *   setting, or a setting is refused.
 */
export function selectionFromFlags(
  provider: string,
  values: CustomFlagValues,
  flag: CustomFlagNames,
  example: string,
): ProviderSelection {
  const given = givenCustomFlags(values, flag);

  if (provider !== CUSTOM_PROVIDER) {
    // A catalog provider knows its own name, issuer and scopes, so a setting
    // given alongside it would be ignored, and an ignored flag reads as honoured.
    if (given.length > 0) {
      throw new ZitadelError(
        "E_VALIDATION",
        `${given.join(", ")} only applies to a custom connection`,
        {
          hint: `Add ${flag.provider} ${CUSTOM_PROVIDER}, or remove ${new Intl.PluralRules("en").select(given.length) === "one" ? "it" : "them"}.`,
          details: { flags: given },
        },
      );
    }
    const selection = parseProviderSelection(provider);
    if (selection === undefined) {
      const known = [...IDP_PROVIDERS, CUSTOM_PROVIDER];
      throw new ZitadelError("E_VALIDATION", `Unknown provider ${provider}`, {
        hint: `Use one of ${known.join(", ")}.`,
      });
    }

    return selection;
  }

  const { slug, displayName, issuer } = values;
  if (slug === undefined || displayName === undefined || issuer === undefined) {
    const missing = [flag.slug, flag.displayName, flag.issuer].filter((name) => {
      return !given.includes(name);
    });
    throw new ZitadelError("E_VALIDATION", `A custom connection needs ${missing.join(", ")}`, {
      hint: `Describe the connection, e.g. ${example}`,
      details: { missing },
    });
  }

  return {
    kind: "custom",
    connection: {
      slug: checkedUnder(flag.slug, parseConnectionSlug(slug, RESERVED_SLUGS)),
      displayName: checkedUnder(flag.displayName, parseDisplayName(displayName)),
      issuer: checkedUnder(flag.issuer, parseIssuer(issuer)),
      scopes: checkedUnder(flag.scopes, parseScopes(values.scopes)),
    },
  };
}

/**
 * The flags that restate a custom connection, for a command offered as text.
 *
 * @remarks
 * Suggested commands are run verbatim, so a display name with a space or a
 * metacharacter in it must arrive as one argument. Nothing here is a
 * credential: the name, issuer and scopes are the developer's own settings.
 *
 * @param custom - The custom connection.
 * @param flag - How the command spells each flag.
 * @returns The flags, each value one shell word.
 */
export function customFlagText(custom: CustomOidcInput, flag: CustomFlagNames): string {
  const values: CustomFlagValues = {
    slug: custom.slug,
    displayName: custom.displayName,
    issuer: custom.issuer,
    scopes: custom.scopes.join(" "),
  };
  return flagText(values, flag);
}

/**
 * The `auth-method sso enable` arguments that add `selection` to a project:
 * the provider, and for a custom connection the settings that describe it.
 *
 * @remarks
 * A suggestion builder wraps them with the selector its command needs.
 *
 * @param selection - The provider.
 * @returns The arguments.
 */
export function ssoEnableArgs(selection: ProviderSelection): string {
  const command = `auth-method sso enable --provider ${selectionName(selection)}`;
  if (selection.kind !== "custom") {
    return command;
  }

  return `${command} ${customFlagText(selection.connection, ENABLE_FLAG_NAMES)}`;
}

/**
 * One value as a single shell word: as it is when it needs no quoting, and in
 * single quotes otherwise.
 *
 * @param value - The value.
 * @returns The word.
 */
function shellWord(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) {
    return value;
  }

  return `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The flags for whichever settings were given, each value as one shell word.
 *
 * @param values - The settings.
 * @param flag - How the command spells each flag.
 * @returns The flags, in command-line order.
 */
export function flagText(values: CustomFlagValues, flag: CustomFlagNames): string {
  return CUSTOM_SETTINGS.flatMap((setting) => {
    const value = values[setting];
    if (value === undefined) {
      return [];
    }

    return [`${flag[setting]} ${shellWord(value)}`];
  }).join(" ");
}
