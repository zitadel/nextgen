import { app } from "../src/app.js";

/**
 * Start a local Node HTTP server that exposes the same Express app the
 * Vercel function serves, so the local dev round-trip is identical to a
 * deployed preview (minus the Vercel transport). The issuer falls back
 * to `http://localhost:<port>` when `VERCEL_URL` is unset — see
 * `src/app.ts`.
 */
const rawPort = process.env.PORT;
const port = rawPort !== undefined ? parseInt(rawPort, 10) : 8080;

if (!Number.isFinite(port) || port < 1 || port > 65535) {
  console.error(
    `[api-mock-deploy] invalid PORT="${rawPort}" — must be an integer between 1 and 65535`,
  );
  process.exit(1);
}

app.listen(port, () => {
  console.log(`api-mock-deploy on http://localhost:${port}`);
});
