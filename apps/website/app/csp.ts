// The website's report-only Content-Security-Policy, which proxy.ts sends with
// each page; the enforced one is next.config.ts'. On the cloud's host the
// website shares an origin with the API and the console, so a script that
// runs here acts with a signed-in user's session.

/** The request header that hands the layout the page's nonce. */
export const NONCE_HEADER = "x-nonce";

/** Where the server collects violation reports (internal/securityheaders). */
const REPORT_PATH = "/csp-report";

/** A nonce for one page: 128 random bits. */
export function createNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The policy the website is to enforce, reported on until no first-party
 * code breaks it. Next.js gives its own scripts the nonce, the layout gives
 * it the theme's; 'strict-dynamic' extends it to the scripts those load
 * (Vercel's analytics).
 *
 * Without a nonce, the policy of a page prerendered at build time, whose
 * inline scripts no request can mark (the changelog): it limits where scripts
 * come from, not which inline ones run.
 */
export function reportOnlyPolicy(nonce: string | undefined) {
  const dev = process.env.NODE_ENV === "development";
  // React rebuilds server error stacks with eval in development only.
  const scripts = nonce ? `'nonce-${nonce}' 'strict-dynamic'` : "'unsafe-inline'";
  return [
    "default-src 'self'",
    `script-src 'self' ${scripts}${dev ? " 'unsafe-eval'" : ""}`,
    // React's and the login previews' style attributes, which a nonce cannot
    // cover; an injected style can restyle a page, not run code.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    // Vercel's analytics on the same origin; next dev's reload socket.
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${REPORT_PATH}`,
  ].join("; ");
}
