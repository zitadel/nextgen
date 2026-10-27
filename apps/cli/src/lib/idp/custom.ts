import {
  CUSTOM_PROVIDER,
  type CustomOidcInput,
  IDP_PROVIDERS,
  isLoopbackIssuer,
  RESERVED_SLUGS,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  parseProviderSelection,
  parseScopes,
  type Parsed,
  type ProviderSelection,
  selectionName,
} from "@zitadel/config/idp";

import { ZitadelError } from "../errors";

/** What the developer typed for a custom connection, before it is checked. */
export type CustomFlagValues = {
  readonly slug?: string;
  readonly displayName?: string;
  readonly issuer?: string;
  readonly scopes?: string;
};

/** How a setting is spelled on the command line, so a message names the flag to fix. */
export type CustomFlagNames = {
  readonly provider: string;
  readonly slug: string;
  readonly displayName: string;
  readonly issuer: string;
  readonly scopes: string;
};

/**
 * The flag keys the two commands define for a custom connection, once. Each
 * command builds its flag definitions from these, reads its parsed flags
 * through them, and the names a message suggests come from them, so renaming
 * one renames the flag, what is read from it, and what is suggested.
 */
export const ENABLE_FLAG_KEYS = {
  provider: "provider",
  slug: "slug",
  displayName: "display-name",
  issuer: "issuer",
  scopes: "scopes",
} as const;

/** The `--sso-*` flags on `setup` that describe the same settings. */
export const SETUP_FLAG_KEYS = {
  provider: "sso",
  slug: "sso-slug",
  displayName: "sso-display-name",
  issuer: "sso-issuer",
  scopes: "sso-scopes",
} as const;

type FlagKeys = {
  readonly provider: string;
  readonly slug: string;
  readonly displayName: string;
  readonly issuer: string;
  readonly scopes: string;
};

const flagNamesOf = (keys: FlagKeys): CustomFlagNames => ({
  provider: `--${keys.provider}`,
  slug: `--${keys.slug}`,
  displayName: `--${keys.displayName}`,
  issuer: `--${keys.issuer}`,
  scopes: `--${keys.scopes}`,
});

/** The flags on `auth-method sso enable`, which a failed setup suggests running instead. */
export const ENABLE_FLAG_NAMES: CustomFlagNames = flagNamesOf(ENABLE_FLAG_KEYS);

/** The `--sso-*` flags on `setup` that describe the same settings. */
export const SETUP_FLAG_NAMES: CustomFlagNames = flagNamesOf(SETUP_FLAG_KEYS);

/**
 * What a command's parsed flags say about a custom connection. Typed by the
 * keys, so the flags a command parsed must carry them.
 */
export function customFlagValues<K extends FlagKeys>(
  flags: { readonly [P in K["slug" | "displayName" | "issuer" | "scopes"]]?: string },
  keys: K,
): CustomFlagValues {
  const read = (key: string) => (flags as Readonly<Record<string, string | undefined>>)[key];
  return {
    slug: read(keys.slug),
    displayName: read(keys.displayName),
    issuer: read(keys.issuer),
    scopes: read(keys.scopes),
  };
}

/**
 * How the target server reaches this machine's loopback: `allowed` for a
 * server `zitadel start` runs as a process with the loopback allow list,
 * `container` for one it runs in Docker, `unknown` for any other.
 */
export type LoopbackReach = "allowed" | "container" | "unknown";

/** The warning a loopback issuer earns on a server that cannot reach it, or `undefined`. */
export function loopbackIssuerWarning(
  selection: ProviderSelection,
  reach: LoopbackReach = "unknown",
): string | undefined {
  if (
    selection.kind !== "custom" ||
    !isLoopbackIssuer(selection.connection.issuer) ||
    reach === "allowed"
  ) {
    return undefined;
  }
  const { issuer } = selection.connection;
  return reach === "container"
    ? `${issuer} is on this machine, but the local server runs in Docker, where localhost is the container itself, so sign-in will fail. Start the server with \`zitadel start --runtime binary\` instead.`
    : `${issuer} is on this machine, and a server blocks requests to localhost unless NEXTGEN_HTTPCLIENT_ALLOW_LIST allows it, so sign-in will fail until it does. A server \`zitadel start\` runs allows it by default.`;
}

/**
 * What a command line describing a custom connection looks like, spelled with
 * the flags the command defines, for an error or a help example to show.
 */
export function customExample(flag: CustomFlagNames, withScopes = false): string {
  return [
    `${flag.provider} ${CUSTOM_PROVIDER}`,
    `${flag.slug} acme-sso`,
    `${flag.displayName} 'Acme SSO'`,
    `${flag.issuer} https://sso.acme.example`,
    ...(withScopes ? [`${flag.scopes} 'openid profile email groups'`] : []),
  ].join(" ");
}

/** The names of the custom settings that were given, as the command spells them. */
export function givenCustomFlags(values: CustomFlagValues, flag: CustomFlagNames): string[] {
  return [
    [flag.slug, values.slug],
    [flag.displayName, values.displayName],
    [flag.issuer, values.issuer],
    [flag.scopes, values.scopes],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name as string);
}

/** One setting's complaint, under the flag that carried it. */
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
 * carried a bad one. For a run that will ask for the rest: a slug the server
 * would refuse is refused before the first question, as a missing client id is.
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
 * The provider a command line names, checked before anything else happens.
 *
 * A catalog provider is just its name. A custom one is described by the
 * settings that follow it, each checked against the contract the server
 * enforces on apply. Every complaint is raised here, before a Project is read
 * or a secret asked for: being turned away after typing a credential would
 * mean typing it again. The settings are flags on purpose — a name, issuer and
 * scopes are what a script or an agent supplies, and what a person can read
 * back from their shell history.
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
          hint: `Add ${flag.provider} ${CUSTOM_PROVIDER}, or remove ${given.length === 1 ? "it" : "them"}.`,
          details: { flags: given },
        },
      );
    }
    const selection = parseProviderSelection(provider);
    if (selection === undefined) {
      throw new ZitadelError("E_VALIDATION", `Unknown provider ${provider}`, {
        hint: `Use one of ${[...IDP_PROVIDERS, CUSTOM_PROVIDER].join(", ")}.`,
      });
    }
    return selection;
  }

  const { slug, displayName, issuer } = values;
  if (slug === undefined || displayName === undefined || issuer === undefined) {
    const missing = [flag.slug, flag.displayName, flag.issuer].filter(
      (name) => !given.includes(name),
    );
    throw new ZitadelError("E_VALIDATION", `A custom connection needs ${missing.join(", ")}`, {
      hint: `Describe the connection, e.g. ${example}`,
      details: { missing },
    });
  }
  const checked = checkedUnder;
  return {
    kind: "custom",
    connection: {
      slug: checked(flag.slug, parseConnectionSlug(slug, RESERVED_SLUGS)),
      displayName: checked(flag.displayName, parseDisplayName(displayName)),
      issuer: checked(flag.issuer, parseIssuer(issuer)),
      scopes: checked(flag.scopes, parseScopes(values.scopes)),
    },
  };
}

/**
 * The flags that restate a custom connection, for a command offered as text.
 *
 * Suggested commands are run verbatim, so a display name with a space or a
 * metacharacter in it must arrive as one argument. Nothing here is a
 * credential: the name, issuer and scopes are the developer's own settings.
 */
export function customFlagText(custom: CustomOidcInput, flag: CustomFlagNames): string {
  return flagText(
    {
      slug: custom.slug,
      displayName: custom.displayName,
      issuer: custom.issuer,
      scopes: custom.scopes.join(" "),
    },
    flag,
  );
}

/**
 * The `auth-method sso enable` arguments that add `selection` to a project:
 * the provider, and for a custom connection the settings that describe it. A
 * suggestion builder wraps them with the selector its command needs.
 */
export function ssoEnableArgs(selection: ProviderSelection): string {
  return `auth-method sso enable --provider ${selectionName(selection)}${
    selection.kind === "custom" ? ` ${customFlagText(selection.connection, ENABLE_FLAG_NAMES)}` : ""
  }`;
}

/** The same for whichever settings were given, each as one shell word. */
export function flagText(values: CustomFlagValues, flag: CustomFlagNames): string {
  const word = (value: string) =>
    /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  return [
    [flag.slug, values.slug],
    [flag.displayName, values.displayName],
    [flag.issuer, values.issuer],
    [flag.scopes, values.scopes],
  ]
    .flatMap(([name, value]) => (value === undefined ? [] : [`${name} ${word(value)}`]))
    .join(" ");
}
