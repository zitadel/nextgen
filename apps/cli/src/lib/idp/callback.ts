/**
 * Where a provider sends the browser back to.
 *
 * Fixed rather than configurable: the route is served by the dev proxy every
 * framework patcher installs, so a Project cannot change it without changing
 * the scaffold, and a developer who has to register the URI with the vendor
 * benefits from it being the same everywhere.
 */
export const IDP_CALLBACK_PATH = "/__nextgen/idp/callback";

/**
 * The redirect URI to register with a provider, on the Project's own origin.
 *
 * The trailing slash an issuer may carry is dropped: vendors match redirect
 * URIs literally, and `http://localhost:3000//__nextgen/...` is a different
 * string from the one the browser will actually arrive at.
 */
export function callbackUriFor(issuer: string): string {
  return `${issuer.replace(/\/$/, "")}${IDP_CALLBACK_PATH}`;
}
