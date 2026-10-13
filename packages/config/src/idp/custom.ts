import { OidcProvider } from "./oidc-provider.js";
import type { CallbackGuidance } from "./provider.js";

/**
 * What `--provider` takes to mean "an OIDC provider the catalog does not
 * list". It is not a catalog entry and has no slug of its own: the developer
 * names the connection.
 */
export const CUSTOM_PROVIDER = "custom";

/** Scopes requested when the developer names none. */
export const DEFAULT_CUSTOM_SCOPES: readonly string[] = Object.freeze([
  "openid",
  "profile",
  "email",
]);

/** The connection's own settings, supplied by the developer. */
export type CustomOidcInput = {
  /** Names the connection; schemas and flows reference it by this. */
  readonly slug: string;
  /** Shown to the user on the sign-in button. */
  readonly displayName: string;
  /** The provider's issuer URL. Its endpoints come from OIDC discovery. */
  readonly issuer: string;
  /** Defaults to {@link DEFAULT_CUSTOM_SCOPES}. */
  readonly scopes?: readonly string[];
};

/**
 * An OIDC provider the developer describes rather than the catalog knows.
 *
 * Everything vendor-specific on {@link OidcProvider} is absent: there is no
 * console to send the developer to, no template, and nothing known about how
 * the provider takes redirect URIs. What it does know is OpenID Connect
 * itself. The claim table is the standard claim set the `profile` and `email`
 * scopes return, so a connection on the default schema maps `email` and trusts
 * it only when the provider says `email_verified` — the same rule Google gets,
 * because it is the standard's, not Google's. Anything beyond that is the
 * developer's to put in the file.
 */
export class CustomOidcProvider extends OidcProvider {
  readonly slug: string;
  readonly displayName: string;
  readonly issuer: string;
  readonly template = undefined;
  readonly consoleUrl = undefined;
  readonly docsUrl = undefined;
  readonly callbackGuidance: CallbackGuidance | undefined = undefined;

  protected readonly claimTable = {
    email: "email",
    givenName: "given_name",
    familyName: "family_name",
  };
  protected readonly scopes: readonly string[];
  protected override readonly verifiedClaims = { email: "email_verified" };

  constructor(input: CustomOidcInput) {
    super();
    this.slug = input.slug;
    this.displayName = input.displayName;
    this.issuer = input.issuer;
    this.scopes = input.scopes ?? DEFAULT_CUSTOM_SCOPES;
  }
}

/** The shape a connection slug must have, as `idp-connection.json` states it. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const SLUG_MAX_LENGTH = 64;
const DISPLAY_NAME_MAX_LENGTH = 256;

/**
 * What is wrong with a slug, or `undefined` when it is fine.
 *
 * `reserved` are the catalog's own slugs. A custom connection under `google`
 * would sit where the Google connection goes and be taken for it.
 */
export function slugProblem(slug: string, reserved: readonly string[] = []): string | undefined {
  if (!SLUG_PATTERN.test(slug) || slug.length > SLUG_MAX_LENGTH) {
    return (
      `Use lowercase letters, digits, "-" and "_", starting with a letter or digit, ` +
      `at most ${SLUG_MAX_LENGTH} characters.`
    );
  }
  if (reserved.includes(slug)) {
    return `"${slug}" is a built-in provider. Choose another name for this connection.`;
  }
  return undefined;
}

/** What is wrong with a display name, or `undefined` when it is fine. */
export function displayNameProblem(displayName: string): string | undefined {
  if (displayName.trim() === "") {
    return "Enter the name shown on the sign-in button.";
  }
  if (displayName.length > DISPLAY_NAME_MAX_LENGTH) {
    return `Use at most ${DISPLAY_NAME_MAX_LENGTH} characters.`;
  }
  return undefined;
}

/**
 * Split a scope list as a developer types it: separated by spaces, commas or
 * both. Duplicates collapse, order is kept, and an empty list is the default
 * set.
 */
export function parseScopes(value: string | undefined): string[] {
  const scopes = (value ?? "").split(/[\s,]+/).filter((scope) => scope !== "");
  return scopes.length === 0 ? [...DEFAULT_CUSTOM_SCOPES] : [...new Set(scopes)];
}

/** What is wrong with a scope list, or `undefined` when it is fine. */
export function scopesProblem(scopes: readonly string[]): string | undefined {
  return scopes.includes("openid")
    ? undefined
    : "The scopes must include openid. Without it the provider returns no id_token.";
}
