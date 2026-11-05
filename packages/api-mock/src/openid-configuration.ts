/**
 * Build the minimal OIDC discovery document this mock advertises.
 *
 * Every real Zitadel server publishes one at
 * `/.well-known/openid-configuration`; the CLI's setup prompt uses it to
 * auto-discover OIDC servers (see `lib/prober`). `server.ts` serves it on
 * that route.
 *
 * @param issuer - Absolute issuer base URL.
 */
export function buildOpenIdConfiguration(issuer: string): Record<string, unknown> {
  return {
    issuer,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/auth/token`,
    end_session_endpoint: `${issuer}/auth/end-session`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}
