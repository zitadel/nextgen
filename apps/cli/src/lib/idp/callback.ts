/**
 * The path a provider sends the browser back to, on the Project's own origin.
 */
export type CallbackPath = `/__nextgen/idp/${string}/callback`;

/**
 * Where a provider sends the browser back to, for the connection `slug`.
 *
 * @remarks
 * Fixed rather than configurable: the route is served by the dev proxy every
 * framework patcher installs, so a Project cannot change it without changing
 * the scaffold, and a developer who has to register the URI with the vendor
 * benefits from it being the same everywhere.
 *
 * One per connection rather than shared: the path names the connection the
 * provider answered, so the engine can refuse a callback that arrives on
 * another connection's route than the one the sign-in started (the mix-up
 * attack, RFC 9700 §4.4). A connection's slug never changes, so neither does
 * its URI.
 *
 * @param slug - The connection's slug.
 * @returns The path, with the slug encoded as one segment.
 */
export function idpCallbackPath(slug: string): CallbackPath {
  return `/__nextgen/idp/${encodeURIComponent(slug)}/callback`;
}

/**
 * The redirect URI to register with a provider for the connection `slug`, on
 * the Project's own origin.
 *
 * @remarks
 * The trailing slash an issuer may carry is dropped: vendors match redirect
 * URIs literally, and `http://localhost:3000//__nextgen/...` is a different
 * string from the one the browser will actually arrive at.
 *
 * @param issuer - The Project's origin.
 * @param slug - The connection's slug.
 * @returns The absolute redirect URI.
 */
export function callbackUriFor(issuer: string, slug: string): `${string}${CallbackPath}` {
  const origin = issuer.replace(/\/$/, "");
  return `${origin}${idpCallbackPath(slug)}`;
}
