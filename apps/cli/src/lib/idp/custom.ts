import {
  CUSTOM_PROVIDER,
  type CustomOidcInput,
  displayNameProblem,
  IDP_PROVIDERS,
  ISSUER_REQUIREMENT,
  isSupportedIssuer,
  parseScopes,
  scopesProblem,
  slugProblem,
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
 * The connection a developer described with flags, checked against the same
 * contract the server enforces on apply.
 *
 * Every complaint is raised here, before a Project is read or a secret asked
 * for: being turned away after typing a credential would mean typing it
 * again. The command is non-interactive about these settings on purpose — the
 * connection's name, issuer and scopes are the kind of input a script or an
 * agent supplies as flags and a person can read back from their shell history.
 */
export function customConnectionFromFlags(
  values: CustomFlagValues,
  flag: CustomFlagNames,
  example: string,
): CustomOidcInput {
  const missing = (
    [
      [flag.slug, values.slug],
      [flag.displayName, values.displayName],
      [flag.issuer, values.issuer],
    ] as const
  )
    .filter(([, value]) => value === undefined)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new ZitadelError("E_VALIDATION", `A custom connection needs ${missing.join(", ")}`, {
      hint: `Describe the connection, e.g. ${example}`,
      details: { missing },
    });
  }
  const slug = (values.slug as string).trim();
  const displayName = (values.displayName as string).trim();
  const issuer = (values.issuer as string).trim();
  const scopes = parseScopes(values.scopes);

  const problems: Array<[string, string | undefined]> = [
    [flag.slug, slugProblem(slug, IDP_PROVIDERS)],
    [flag.displayName, displayNameProblem(displayName)],
    [flag.issuer, isSupportedIssuer(issuer) ? undefined : ISSUER_REQUIREMENT],
    [flag.scopes, scopesProblem(scopes)],
  ];
  const [first] = problems.filter(([, problem]) => problem !== undefined);
  if (first !== undefined) {
    const [name, problem] = first;
    throw new ZitadelError("E_VALIDATION", `${name}: ${problem}`, {
      hint: `Fix ${name} and run the command again.`,
      details: { flag: name },
    });
  }
  return { slug, displayName, issuer, scopes };
}

/**
 * Stop when a custom setting is given for a provider the catalog already
 * describes. A catalog provider knows its own name, issuer and scopes, so one
 * given alongside it would be ignored, and an ignored flag reads as honoured.
 */
export function refuseCustomFlagsWithoutCustom(
  values: CustomFlagValues,
  flag: CustomFlagNames,
  provider: string | undefined,
): void {
  if (provider === CUSTOM_PROVIDER) {
    return;
  }
  const given = (
    [
      [flag.slug, values.slug],
      [flag.displayName, values.displayName],
      [flag.issuer, values.issuer],
      [flag.scopes, values.scopes],
    ] as const
  )
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
  if (given.length === 0) {
    return;
  }
  throw new ZitadelError(
    "E_VALIDATION",
    `${given.join(", ")} only applies to a custom connection`,
    {
      hint: `Add ${flag.provider} ${CUSTOM_PROVIDER}, or remove ${given.length === 1 ? "it" : "them"}.`,
      details: { flags: given },
    },
  );
}

/** A value as one shell word, quoted only when it has to be. */
function shellWord(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

/**
 * The flags that restate a custom connection, for a command offered as text.
 *
 * Suggested commands are run verbatim, so a display name with a space or a
 * metacharacter in it must arrive as one argument. Nothing here is a
 * credential: the name, issuer and scopes are the developer's own settings.
 */
export function customFlagText(custom: CustomOidcInput, flag: CustomFlagNames): string {
  return [
    `${flag.slug} ${shellWord(custom.slug)}`,
    `${flag.displayName} ${shellWord(custom.displayName)}`,
    `${flag.issuer} ${shellWord(custom.issuer)}`,
    ...(custom.scopes === undefined
      ? []
      : [`${flag.scopes} ${shellWord(custom.scopes.join(" "))}`]),
  ].join(" ");
}
