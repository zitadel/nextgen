import { DEFAULT_PORT, parsePort } from "../src/issuer.js";

/**
 * Start a local Node HTTP server that exposes the same Express app the
 * Vercel function serves, so the local dev round-trip is identical to a
 * deployed preview (minus the Vercel transport). The issuer falls back
 * to `http://localhost:<port>` when `VERCEL_URL` is unset — see
 * `src/app.ts`.
 */
// Validate PORT *before* importing the app. `parsePort` is shared with
// resolveIssuer so the bind port matches the issuer exactly. Unset/empty
// PORT falls back to DEFAULT_PORT; a *set but invalid* value (non-numeric
// or out of range) fails loudly rather than silently binding 8080.
const rawPort = process.env.PORT?.trim();
const port = parsePort(rawPort);

if (rawPort && port === null) {
  console.error(
    `[mock-zitadel] invalid PORT="${rawPort}" — must be an integer between 1 and 65535`,
  );
  process.exit(1);
}

// Import the app only after PORT is known good, so an invalid config exits
// before the app's module-level construction (keypair generation, handler
// setup, branding) runs.
const { app } = await import("../src/app.js");

app.listen(port ?? DEFAULT_PORT, () => {
  console.log(`mock-zitadel on http://localhost:${port ?? DEFAULT_PORT}`);
});
