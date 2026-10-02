import type { CallbackGuidance } from "./provider.js";

import { OidcProvider } from "./oidc-provider.js";

/**
 * Google, as `zitadel setup` and `sso enable` scaffold it.
 *
 * Everything here is Google's own documented behaviour, cross-checked against
 * its discovery document and the provider packages in zitadel/zitadel. It names
 * no endpoints: Google publishes a discovery document, its endpoints do not
 * share the issuer's host, and the engine resolves them at runtime — so a value
 * committed here would be a guess that ages.
 */
export class GoogleProvider extends OidcProvider {
  readonly slug = "google";
  readonly displayName = "Google";
  readonly template = "google";
  readonly consoleUrl = "https://console.cloud.google.com/apis/credentials";
  readonly docsUrl = "https://developers.google.com/identity/openid-connect/openid-connect";
  /** One client takes many redirect URIs, so one application serves every environment. */
  readonly callbackGuidance: CallbackGuidance = "multi_uri_client";
  readonly issuer = "https://accounts.google.com";

  protected readonly claimTable = {
    email: "email",
    givenName: "given_name",
    familyName: "family_name",
  };

  protected readonly scopes = ["openid", "profile", "email"];

  /** `sub` never changes, unlike an email, so identity keys on it. */
  protected override readonly subjectClaim = "sub";

  protected override readonly verifiedClaims = { email: "email_verified" };

  /** Google reuses a signed-in session silently without it. */
  protected override readonly staticAuthorizeParameters = { prompt: "select_account" };
}
