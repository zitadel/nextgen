// The mock OIDC provider (tools/oidc-mock) as the journey runner registers it.
// The specs import these constants; only the issuer changes per lane, and the
// runner hands it to Playwright as JOURNEY_OIDC_MOCK_URL.
export const OIDC_MOCK_SLUG = "mock-idp";
export const OIDC_MOCK_CLIENT_ID = "journey";
export const OIDC_MOCK_CLIENT_SECRET = "journey-secret";
// The server builds the provider redirect from the browser origin (the app),
// whose dev proxy forwards /__nextgen/* to the server.
export const OIDC_MOCK_REDIRECT_PATH = `/__nextgen/idp/${OIDC_MOCK_SLUG}/callback`;
