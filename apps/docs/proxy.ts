import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { type NextRequest, NextResponse } from "next/server";

import { createNonce, nonceHeader, reportOnlyPolicy } from "@/lib/csp";
import { docsContentRoute, docsRoute } from "@/lib/shared";

const { rewrite: rewriteDocs } = rewritePath(
  `${docsRoute}{/*path}`,
  `${docsContentRoute}{/*path}/content.md`,
);
const { rewrite: rewriteSuffix } = rewritePath(
  `${docsRoute}{/*path}.md`,
  `${docsContentRoute}{/*path}/content.md`,
);

export default function proxy(request: NextRequest) {
  const result = rewriteSuffix(request.nextUrl.pathname);
  if (result) {
    return NextResponse.rewrite(new URL(result, request.nextUrl));
  }

  if (isMarkdownPreferred(request)) {
    const result = rewriteDocs(request.nextUrl.pathname);

    if (result) {
      return NextResponse.rewrite(new URL(result, request.nextUrl), {
        // this URL has two representations, selected by `Accept`
        headers: { Vary: "Accept" },
      });
    }
  }

  return withPolicy(request);
}

/**
 * A page with its report-only policy (lib/csp.ts) and a nonce of its own,
 * which the request hands to Next.js and the layout. Rendering a nonce into a
 * page takes a render per request: the root layout reads it, so no page is
 * prerendered.
 *
 * Next.js copies the headers a proxy answers with onto the request and takes
 * the nonce from its Content-Security-Policy before its report-only one, so
 * the enforced policy, which has none, is set by next.config.mjs instead.
 */
function withPolicy(request: NextRequest) {
  const nonce = createNonce();
  const reportOnly = reportOnlyPolicy(nonce);
  const headers = new Headers(request.headers);
  headers.set(nonceHeader, nonce);
  headers.set("content-security-policy-report-only", reportOnly);
  // On Vercel the request also carries next.config's enforced policy, which
  // Next.js reads first; a request header binds no browser, so give it the
  // nonce's policy.
  headers.set("content-security-policy", reportOnly);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy-Report-Only", reportOnly);
  return response;
}

export const config = {
  // Pages only. The docs' other routes live under /docs as well, so an agent
  // asking for Markdown or plain text must reach them unchanged: search and
  // the MCP server (api/), llms.txt, the OpenAPI document, the live examples'
  // service worker, the Open Graph images and the assets.
  matcher: [
    "/docs",
    "/docs/((?!api/|llms\\.txt|llms-full\\.txt|openapi\\.json|mock-service-worker\\.js|og/|_next/).*)",
  ],
};
