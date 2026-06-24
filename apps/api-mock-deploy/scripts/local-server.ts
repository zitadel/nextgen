import { app } from "../src/app.js";

/**
 * Start a local Node HTTP server that exposes the same Express app the
 * Vercel function serves, so the local dev round-trip is identical to a
 * deployed preview (minus the Vercel transport). The issuer falls back
 * to `http://localhost:<port>` when `VERCEL_URL` is unset — see
 * `src/app.ts`.
 */
const port = Number(process.env.PORT ?? 8080);

app.listen(port, () => {
  console.log(`api-mock-deploy on http://localhost:${port}`);
});
