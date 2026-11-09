import {
  type ClientId,
  type ClientIdVariable,
  type ClientSecret,
  type ClientSecretVariable,
  type ConnectionSlug,
  credentialVariables,
  DEFAULT_SCOPES,
  type DisplayName,
  type Issuer,
  type ProviderSelection,
  parseClientId,
  parseClientSecret,
  parseConnectionSlug,
  parseDisplayName,
  parseIssuer,
  validated,
} from "@zitadel/config/idp";

/**
 * A connection slug, parsed as a command parses `--slug`.
 *
 * @param value - The slug's text, such as `acme-sso`.
 * @returns The slug.
 * @throws {@link Error} When the text is not a slug, so a test cannot hold a
 *   value the CLI would refuse.
 */
export function slug(value: string): ConnectionSlug {
  return validated(parseConnectionSlug(value));
}

/**
 * The text of a sign-in button, parsed as a command parses `--display-name`.
 *
 * @param value - The text, such as `Acme SSO`.
 * @returns The display name.
 * @throws {@link Error} When the text is empty or too long.
 */
export function displayName(value: string): DisplayName {
  return validated(parseDisplayName(value));
}

/**
 * An issuer URL, parsed as a command parses `--issuer`.
 *
 * @param value - The URL, such as `https://sso.acme.example`.
 * @returns The issuer.
 * @throws {@link Error} When the server would not accept the URL.
 */
export function issuer(value: string): Issuer {
  return validated(parseIssuer(value));
}

/**
 * A client id, parsed as a command parses `--client-id`.
 *
 * @param value - The client id.
 * @returns The client id.
 * @throws {@link Error} When the text is empty.
 */
export function clientId(value: string): ClientId {
  return validated(parseClientId(value));
}

/**
 * A client secret, parsed as a command parses a piped or typed secret.
 *
 * @param value - The secret.
 * @returns The client secret.
 * @throws {@link Error} When the text is empty.
 */
export function clientSecret(value: string): ClientSecret {
  return validated(parseClientSecret(value));
}

/**
 * The project variable holding a connection's client id, named as the CLI
 * names it from the slug.
 *
 * @param connection - The connection's slug, such as `google`.
 * @returns The variable's name, such as `GOOGLE_CLIENT_ID`.
 * @throws {@link Error} When the text is not a slug.
 */
export function idVariable(connection: string): ClientIdVariable {
  return credentialVariables(slug(connection)).clientId;
}

/**
 * The project variable holding a connection's client secret, named as the CLI
 * names it from the slug.
 *
 * @param connection - The connection's slug, such as `google`.
 * @returns The variable's name, such as `GOOGLE_CLIENT_SECRET`.
 * @throws {@link Error} When the text is not a slug.
 */
export function secretVariable(connection: string): ClientSecretVariable {
  return credentialVariables(slug(connection)).clientSecret;
}

/**
 * The Google provider, as a command or an answer names it.
 */
export const googleSelection: ProviderSelection = { kind: "catalog", id: "google" };

/**
 * A custom connection, as a command or an answer describes one.
 */
export const acmeSelection = {
  kind: "custom",
  connection: {
    slug: slug("acme"),
    displayName: displayName("Acme SSO"),
    issuer: issuer("https://sso.acme.example"),
    scopes: DEFAULT_SCOPES,
  },
} as const satisfies ProviderSelection;
