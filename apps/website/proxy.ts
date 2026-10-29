import { type NextRequest, NextResponse } from "next/server";

import { createNonce, NONCE_HEADER, reportOnlyPolicy } from "./app/csp";

/**
 * The changelog's pages, built from the repository and prerendered
 * (changelog/page.tsx): no request renders them, so none can mark their
 * scripts with a nonce.
 */
const prerendered = /^\/changelog(\/|$)/;

/**
 * Each page with its report-only policy (app/csp.ts) and, unless it is
 * prerendered, a nonce of its own, which the request hands to Next.js and the
 * layout. Rendering a nonce into a page takes a render per request: the root
 * layout reads it, so the front page is not prerendered.
 *
 * Next.js copies the headers a proxy answers with onto the request and takes
 * the nonce from its Content-Security-Policy before its report-only one, so
 * the enforced policy, which has none, is set by next.config.ts instead.
 */
export default function proxy(request: NextRequest) {
  const nonce = prerendered.test(request.nextUrl.pathname) ? undefined : createNonce();
  const reportOnly = reportOnlyPolicy(nonce);
  const headers = new Headers(request.headers);
  if (nonce) headers.set(NONCE_HEADER, nonce);
  headers.set("content-security-policy-report-only", reportOnly);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy-Report-Only", reportOnly);
  return response;
}

export const config = {
  // Pages only: the assets, the favicons, llms.txt and the changelog's feed
  // run no script.
  matcher: ["/((?!_next/|favicons/|favicon\\.ico|llms\\.txt|changelog/feed\\.xml).*)"],
};
