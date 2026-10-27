/**
 * Loads `.env.local`, where `zitadel setup` writes the app's settings, into
 * `process.env`. SvelteKit loads env files only into its `$env` modules, never
 * onto `process.env`, so without this `createNextgenHandle`'s defaults would
 * miss them, and an app would have to load the file itself and type-check
 * against Node's types to do so. A variable already set wins, and a runtime
 * without `process.loadEnvFile` or a missing file leaves the environment as it
 * is.
 */
export function loadEnvLocal(): void {
  if (typeof process === "undefined" || typeof process.loadEnvFile !== "function") {
    return;
  }
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // .env.local is optional: in production the platform provides the variables.
  }
}
