/**
 * The endpoint rule the server applies to an `oidc` block (`idp.endpoints_partial`).
 *
 * A connection either names no endpoint, and the engine reads them all from the
 * issuer's discovery document, or names every one it needs: the authorization,
 * token and JWKS endpoints, and the userinfo endpoint unless the claims come from
 * the id_token. Anything in between is refused, so this mirrors the server to
 * let a plan refuse it before an apply starts.
 */

/** The endpoints an `oidc` block may name, in the order the server reports them missing. */
export const OIDC_ENDPOINTS = Object.freeze([
  "authorization_endpoint",
  "jwks_uri",
  "token_endpoint",
  "userinfo_endpoint",
] as const);

export type OidcEndpoint = (typeof OIDC_ENDPOINTS)[number];

/**
 * The endpoints a partial `oidc` block leaves out, in the server's order, or an
 * empty list when the block names none of them (discovery) or every one it
 * needs. Anything that is not an object reads as a block naming none.
 */
export function missingEndpoints(oidc: unknown): OidcEndpoint[] {
  if (typeof oidc !== "object" || oidc === null || Array.isArray(oidc)) {
    return [];
  }
  const block = oidc as Record<string, unknown>;
  const isSet = (name: OidcEndpoint) => block[name] !== undefined && block[name] !== "";
  if (!OIDC_ENDPOINTS.some(isSet)) {
    return [];
  }
  return OIDC_ENDPOINTS.filter(
    (name) => !isSet(name) && !(name === "userinfo_endpoint" && block.id_token_mapping === true),
  );
}
