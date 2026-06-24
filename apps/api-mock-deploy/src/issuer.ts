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
export function resolveIssuer(env: NodeJS.ProcessEnv = process.env): string {
  // Treat empty/whitespace as unset: `??` would let `VERCEL_URL=""` or
  // `PORT=""` through and produce a malformed issuer like `https://` or
  // `http://localhost:`. `trim() || fallback` collapses both cases.
  const vercelUrl = env.VERCEL_URL?.trim();
  if (vercelUrl) {
    return `https://${vercelUrl}`;
  }
  const port = env.PORT?.trim() || "8080";
  return `http://localhost:${port}`;
}
