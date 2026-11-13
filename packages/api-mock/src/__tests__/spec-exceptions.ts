/**
 * Where the conformance spec lets the mock differ from the OpenAPI contract,
 * each with why. Keep both lists short: an entry is a gap to close, in the
 * spec or in the mock, not a place to park drift.
 */

/**
 * The mock's routes that are no operation of the OpenAPI spec, each with why
 * the mock serves it. The conformance spec fails a route that is neither in
 * the spec nor here, and an entry here that no route matches or that the spec
 * has since gained.
 */
export const OUT_OF_SPEC_ROUTES: Readonly<Record<string, string>> = {
  "GET /.well-known/jwks.json": "the key the mock signs handoff tokens with; a dev convenience",
  "GET /auth/keys":
    "the JWKS at the URL sdk-core's JWT verifier derives; the server's OIDC surface is outside api/openapi",
  "GET /.well-known/openid-configuration":
    "OIDC discovery, which the server's OIDC surface serves outside api/openapi",
  "GET /auth/end-session":
    "OIDC end-session, outside api/openapi; clears the mock's session cookie",
  "GET /console/runtime.json":
    "the console's runtime document, served by the server's root mux (cmd/server/console_runtime.go)",
  "GET /__nextgen/idp/callback":
    "the identity provider's return (internal/api/idp_callback.go), a browser redirect outside api/openapi",
  "GET /idp/callback":
    "the same return, at the path an SDK proxy forwards after stripping its prefix",
};

/**
 * Answers the spec describes wrongly for the real server, keyed
 * `<operationId> <status>`, each with where the server says otherwise. For
 * these, an answer that breaks the status's declared schema may instead match
 * the operation's `default` error set. Fix the spec, then drop the entry.
 */
export const SPEC_GAPS: Readonly<Record<string, string>> = {
  "submitFlowStep 400":
    "the spec's 400 is a flow-response only; the server also answers req.invalid and flow.invalid_action as a 400 error envelope (internal/api/flow.go flowErrorResponse)",
};
