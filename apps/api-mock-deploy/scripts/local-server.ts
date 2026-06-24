import { app } from "../src/app.js";
import { DEFAULT_PORT, parsePort } from "../src/issuer.js";

/**
 * Start a local Node HTTP server that exposes the same Express app the
 * Vercel function serves, so the local dev round-trip is identical to a
 * deployed preview (minus the Vercel transport). The issuer falls back
 * to `http://localhost:<port>` when `VERCEL_URL` is unset — see
 * `src/app.ts`.
 */
// Use the shared `parsePort` so the bind port matches the issuer exactly.
// Unset/empty PORT falls back to DEFAULT_PORT; a *set but invalid* value
// (non-numeric or out of range) is a mistake worth failing loudly on,
// rather than silently binding 8080.
const rawPort = process.env.PORT?.trim();
const port = parsePort(rawPort);

if (rawPort && port === null) {
  console.error(
    `[api-mock-deploy] invalid PORT="${rawPort}" — must be an integer between 1 and 65535`,
  );
  process.exit(1);
}

app.listen(port ?? DEFAULT_PORT, () => {
  console.log(`api-mock-deploy on http://localhost:${port ?? DEFAULT_PORT}`);
});
