import { OidcProvider } from "./oidc-provider.js";
import type { CallbackGuidance } from "./provider.js";
import type { ConnectionSlug, DisplayName, Issuer, Scopes } from "./types.js";

/**
 * What `--provider` takes to mean "an OIDC provider the catalog does not
 * list". It is not a catalog entry and has no slug of its own: the developer
 * names the connection.
 */
export const CUSTOM_PROVIDER = "custom";

/** The connection's own settings, supplied by the developer. */
export type CustomOidcInput = {
  /** Names the connection; schemas and flows reference it by this. */
  readonly slug: ConnectionSlug;
  readonly displayName: DisplayName;
  /** Its endpoints come from OIDC discovery. */
  readonly issuer: Issuer;
  readonly scopes: Scopes;
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
  readonly template = undefined;
  readonly consoleUrl = undefined;
  readonly docsUrl = undefined;
  readonly callbackGuidance: CallbackGuidance | undefined = undefined;
  readonly slug: ConnectionSlug;
  readonly displayName: DisplayName;
  readonly issuer: Issuer;
  protected readonly scopes: Scopes;

  protected readonly claimTable = {
    email: "email",
    givenName: "given_name",
    familyName: "family_name",
  };
  protected override readonly verifiedClaims = { email: "email_verified" };

  constructor(input: CustomOidcInput) {
    super();
    this.slug = input.slug;
    this.displayName = input.displayName;
    this.issuer = input.issuer;
    this.scopes = input.scopes;
  }
}
