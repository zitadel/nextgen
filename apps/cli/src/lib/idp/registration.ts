import type { IdpProvider } from "@zitadel/config/idp";

/**
 * What a person needs to register the OAuth application a connection signs in
 * with: where to create it, if the catalog knows, and the redirect URI to add.
 * The redirect URI is on a line of its own so it can be copied whole, because
 * the provider matches it literally.
 *
 * @param issuer - Where the connection points when that is not the vendor,
 *   which a development run does to stand a provider up locally. Pointing a
 *   person at the vendor's console then would be worse than saying nothing.
 */
export function registrationLines(
  provider: IdpProvider,
  callbackUri: string,
  issuer?: string,
): string[] {
  const name = `"${provider.displayName}"`;
  if (issuer === undefined && provider.consoleUrl !== undefined) {
    return [
      `${name} needs an OAuth application. Create one at`,
      provider.consoleUrl,
      "and add this authorized redirect URI to it:",
      callbackUri,
    ];
  }
  return [
    `${name} needs an OAuth application at ${issuer ?? provider.issuer}.`,
    "Add this redirect URI to it:",
    callbackUri,
  ];
}
