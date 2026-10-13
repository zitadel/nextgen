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

/** The flags on `sso enable`, which a failed setup suggests running instead. */
export const ENABLE_FLAG_NAMES: CustomFlagNames = {
  provider: "--provider",
  slug: "--slug",
  displayName: "--display-name",
  issuer: "--issuer",
  scopes: "--scopes",
};

/** The `--sso-*` flags on `setup` that describe the same settings. */
export const SETUP_FLAG_NAMES: CustomFlagNames = {
  provider: "--sso",
  slug: "--sso-slug",
  displayName: "--sso-display-name",
  issuer: "--sso-issuer",
  scopes: "--sso-scopes",
};

/** The warning a loopback issuer earns, or `undefined`: the server reaches only what its egress allow list permits. */
export function loopbackIssuerWarning(selection: ProviderSelection): string | undefined {
  return selection.kind === "custom" && isLoopbackIssuer(selection.connection.issuer)
    ? `${selection.connection.issuer} is on this machine, and the server blocks requests to localhost unless NEXTGEN_HTTPCLIENT_ALLOW_LIST allows it, so sign-in will fail until it does.`
    : undefined;
}

/** What a command's parsed flags say about a custom connection, whichever prefix they carry. */
export function customFlagValues(
  flags: Readonly<Record<string, unknown>>,
  prefix: "" | "sso-",
): CustomFlagValues {
  const read = (name: string) => {
    const value = flags[`${prefix}${name}`];
    return typeof value === "string" ? value : undefined;
  };
  return {
    slug: read("slug"),
    displayName: read("display-name"),
    issuer: read("issuer"),
    scopes: read("scopes"),
  };
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
  // Each setting says what is wrong with it, under the flag that carried it.
  const checked = <T>(name: string, parsed: Parsed<T>): T => {
    if (!parsed.ok) {
      throw new ZitadelError("E_VALIDATION", `${name}: ${parsed.problem}`, {
        hint: `Fix ${name} and run the command again.`,
        details: { flag: name },
      });
    }
    return parsed.value;
  };
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
  const word = (value: string) =>
    /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
  return [
    `${flag.slug} ${word(custom.slug)}`,
    `${flag.displayName} ${word(custom.displayName)}`,
    `${flag.issuer} ${word(custom.issuer)}`,
    `${flag.scopes} ${word(custom.scopes.join(" "))}`,
  ].join(" ");
}
