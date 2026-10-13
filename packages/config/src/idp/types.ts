import { ISSUER_REQUIREMENT, isSupportedIssuer } from "./issuer.js";

/**
 * The values a connection is made of, as types the compiler tells apart.
 *
 * A connection's slug, its issuer, its client id, its client secret and the
 * names of the project variables that hold the last two are all text, and every
 * function that handled them took `string`. Passing the secret's variable name
 * where the client id's belonged, or a provider name where a slug did, compiled
 * and then published a credential to the wrong place. Each value now has its
 * own type, and the only way to make one is a parser that checks it.
 *
 * A brand costs nothing at runtime: each is still the string it wraps.
 */
declare const brand: unique symbol;
type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

/** What schemas and flows call a connection by, e.g. `acme-sso`. */
export type ConnectionSlug = Brand<string, "ConnectionSlug">;
/** Shown to the user on the connection's sign-in button. */
export type DisplayName = Brand<string, "DisplayName">;
/** The provider's issuer URL, one the server accepts. */
export type Issuer = Brand<string, "Issuer">;
/** The client id of the application registered with the provider. */
export type ClientId = Brand<string, "ClientId">;
/** The client secret of that application. Never written to a file. */
export type ClientSecret = Brand<string, "ClientSecret">;
/** The name of the project variable holding a connection's client id. */
export type ClientIdVariable = Brand<string, "ClientIdVariable">;
/** The name of the project variable holding a connection's client secret. */
export type ClientSecretVariable = Brand<string, "ClientSecretVariable">;

/**
 * The scopes a connection requests. `openid` leads, which is what makes the
 * connection OpenID Connect at all — without it the provider returns no
 * id_token — so a list without it is not a value of this type.
 */
export type Scopes = readonly ["openid", ...string[]];

/** Both halves of the application's credentials, which a working sign-in needs. */
export type Credentials = {
  readonly clientId: ClientId;
  readonly secret: ClientSecret;
};

/** A parsed value, or what is wrong with the text it came from. */
export type Parsed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problem: string };

/**
 * The value of text something has already checked, such as an answer a prompt
 * refused to accept until it parsed. Throws on text that does not parse,
 * because by then that is a bug and not an input to turn away.
 */
export function validated<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) {
    throw new Error(`text that was checked does not parse: ${parsed.problem}`);
  }
  return parsed.value;
}

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const refuse = <T>(problem: string): Parsed<T> => ({ ok: false, problem });

/** The shape a slug must have, as `idp-connection.json` states it. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * A connection slug, or what is wrong with the text.
 *
 * `reserved` are the catalog's own slugs. A custom connection under `google`
 * would sit where the Google connection goes and be taken for it.
 */
export function parseConnectionSlug(
  value: string,
  reserved: readonly string[] = [],
): Parsed<ConnectionSlug> {
  if (!SLUG_PATTERN.test(value) || value.length > 64) {
    return refuse(
      'Use lowercase letters, digits, "-" and "_", starting with a letter or digit, at most 64 characters.',
    );
  }
  if (reserved.includes(value)) {
    return refuse(`"${value}" is a built-in provider. Choose another name for this connection.`);
  }
  return ok(value as ConnectionSlug);
}

/** The text on the sign-in button, or why there is none. */
export function parseDisplayName(value: string): Parsed<DisplayName> {
  const trimmed = value.trim();
  if (trimmed === "") {
    return refuse("Enter the name shown on the sign-in button.");
  }
  return trimmed.length > 256 ? refuse("Use at most 256 characters.") : ok(trimmed as DisplayName);
}

/** An issuer the server accepts: https anywhere, or http on loopback for a stand-in. */
export function parseIssuer(value: string): Parsed<Issuer> {
  const trimmed = value.trim();
  return isSupportedIssuer(trimmed) ? ok(trimmed as Issuer) : refuse(ISSUER_REQUIREMENT);
}

/** The scopes typed as people type them: separated by spaces, commas or both. */
export const DEFAULT_SCOPES: Scopes = ["openid", "profile", "email"];

/**
 * A scope list from its text. Nothing typed is the default set; duplicates
 * collapse; `openid` is required and is moved to the front.
 */
export function parseScopes(value: string | undefined): Parsed<Scopes> {
  const typed = (value ?? "").split(/[\s,]+/).filter((scope) => scope !== "");
  if (typed.length === 0) {
    return ok(DEFAULT_SCOPES);
  }
  if (!typed.includes("openid")) {
    return refuse("The scopes must include openid. Without it the provider returns no id_token.");
  }
  return ok(["openid", ...new Set(typed.filter((scope) => scope !== "openid"))]);
}

/** A client id, or why none was given. Vendors format them differently, so only emptiness is checked. */
export function parseClientId(value: string): Parsed<ClientId> {
  const trimmed = value.trim();
  return trimmed === "" ? refuse("Enter the client id.") : ok(trimmed as ClientId);
}

/** A client secret, or why none was given. */
export function parseClientSecret(value: string): Parsed<ClientSecret> {
  const trimmed = value.trim();
  return trimmed === "" ? refuse("Enter the client secret.") : ok(trimmed as ClientSecret);
}
