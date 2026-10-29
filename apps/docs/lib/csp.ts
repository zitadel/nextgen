// The docs pages' report-only Content-Security-Policy, which proxy.ts sends
// with each page; the enforced one is next.config.mjs'. On the cloud's host
// the docs share an origin with the API and the console, so a script that
// runs here acts with a signed-in user's session.

/** The request header that hands the layout the page's nonce. */
export const nonceHeader = "x-nonce";

/** Where the server collects violation reports (internal/securityheaders). */
const reportPath = "/csp-report";

/** A nonce for one page: 128 random bits. */
export function createNonce() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * The policy the docs are to enforce, reported on until no first-party code
 * breaks it. Next.js gives its own scripts the nonce; 'strict-dynamic'
 * extends it to the scripts those load (Vercel's analytics).
 */
export function reportOnlyPolicy(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // React rebuilds server error stacks with eval in development only.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Code blocks colour their tokens with style attributes (Shiki), which a
    // nonce cannot cover; an injected style can restyle a page, not run code.
    "style-src 'self' 'unsafe-inline'",
    // The live examples show a branding's logo, which may be any https URL.
    "img-src 'self' data: https:",
    // The live examples' mock runs in a service worker
    // (/docs/mock-service-worker.js), which script-src cannot allow by nonce.
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    `report-uri ${reportPath}`,
  ].join("; ");
}
