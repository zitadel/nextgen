/**
 * Resolve the absolute base URL this deployment advertises as its OIDC
 * issuer.
 *
 * On Vercel, `VERCEL_URL` holds the immutable per-deployment domain
 * (e.g. `nextgen-api-mock-git-pr-123.vercel.app`) — every preview build
 * gets its own, which is exactly the per-PR isolation we want. Falling
 * back to a localhost issuer keeps `vercel dev` and plain `node` runs
 * working unchanged.
 *
 * The value only has to be internally consistent: the mock both signs
 * handoff tokens with this issuer and verifies them against it, so as
 * long as a single deployment uses one issuer string, exchange succeeds
 * regardless of which alias the caller hit.
 *
 * Lives in its own module (no Express/app side effects) so a build step
 * can import it to stamp static assets without constructing the app.
 *
 * @param env - Environment to read from; injectable for tests.
 */
/** Port the mock binds to / advertises when `PORT` is unset or invalid. */
export const DEFAULT_PORT = 8080;

/**
 * Parse a TCP port from a raw env value.
 *
 * Returns the integer only when the value is a plain decimal in the
 * 1–65535 range; returns `null` for unset, empty/whitespace, non-numeric
 * (`"8080abc"`), or out-of-range (`"0"`, `"99999"`) input — so callers can
 * decide whether to fall back (the issuer) or reject (the dev server).
 * Shared so the bind port and the advertised issuer never disagree.
 */
export function parsePort(raw: string | undefined): number | null {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? port : null;
}

export function resolveIssuer(env: NodeJS.ProcessEnv = process.env): string {
  // Treat empty/whitespace/invalid as unset: `??` would let `VERCEL_URL=""`
  // through and produce `https://`, and a bad `PORT` would produce a
  // malformed/out-of-range issuer. Fall back to localhost:DEFAULT_PORT.
  const vercelUrl = env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }
  return `http://localhost:${parsePort(env.PORT) ?? DEFAULT_PORT}`;
}
