// The mock OIDC provider (tools/oidc-mock) as the journey runner registers it.
// The specs do not import this module: they read the same values from the
// JOURNEY_OIDC_MOCK_* variables the runner hands Playwright.
export const OIDC_MOCK_SLUG = "mock-idp";
export const OIDC_MOCK_CLIENT_ID = "journey";
export const OIDC_MOCK_CLIENT_SECRET = "journey-secret";
// The server builds the provider redirect from the browser origin (the app),
// whose dev proxy forwards /__nextgen/* to the server.
export const OIDC_MOCK_REDIRECT_PATH = `/__nextgen/idp/${OIDC_MOCK_SLUG}/callback`;
