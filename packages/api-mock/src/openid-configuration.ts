/**
 * Build the minimal OIDC discovery document this mock advertises.
 *
 * Every real Zitadel server publishes one at
 * `/.well-known/openid-configuration`; the CLI's setup prompt uses it to
 * auto-discover OIDC servers (see `lib/prober`).
 *
 * This module is intentionally **side-effect free** — it imports nothing
 * and initializes nothing — so a build step can import it to emit the
 * document as a static asset without pulling in `server.ts` (and, through
 * it, `crypto.ts`'s top-level WebCrypto keypair generation). The Express
 * server re-exports it from `./server` for the live route.
 *
 * @param issuer - Absolute issuer base URL.
 * @param options.jwksUri - Absolute URL clients should fetch the JWKS
 *   from. Defaults to `${issuer}/.well-known/jwks.json`; a host that
 *   reserves `/.well-known/*` (Vercel) overrides it to `${issuer}/auth/keys`,
 *   which the mock serves identically.
 */
export function buildOpenIdConfiguration(
  issuer: string,
  options: { jwksUri?: string } = {},
): Record<string, unknown> {
  return {
    issuer,
    jwks_uri: options.jwksUri ?? `${issuer}/.well-known/jwks.json`,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/auth/token`,
    end_session_endpoint: `${issuer}/auth/end-session`,
    response_types_supported: ["code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
  };
}
