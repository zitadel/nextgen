/**
 * The values a command reads from an environment. Each resolves on its own, so
 * a file holding only the project id leaves the server to the process
 * environment. `ZITADEL_ISSUER` is the origin the app serves from, which
 * `setup` records beside the CLI's own values.
 */
export const ENVIRONMENT_KEYS = [
  "ZITADEL_URL",
  "ZITADEL_PROJECT_ID",
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
  "ZITADEL_PUBLISHABLE_KEY",
  "ZITADEL_RELEASE",
  "ZITADEL_ISSUER",
] as const;

/** The values that grant access, prompted without echo and persisted at 0600. */
export const SECRET_KEYS: ReadonlySet<(typeof ENVIRONMENT_KEYS)[number]> = new Set([
  "ZITADEL_PROJECT_SECRET",
  "ZITADEL_PREVIEW_TOKEN",
]);
