/**
 * Vercel Edge Middleware shim for @zitadel/edge-proxy.
 *
 * Place this file at your project root as `middleware.ts`. As Edge Middleware it
 * runs before routing and intercepts `/__nextgen/*` directly via the matcher —
 * no `vercel.json` rewrite or `api/` function needed. (For a static Vite SPA,
 * Vercel does not build an `api/` function, so middleware is the approach that
 * works.)
 *
 * Set NEXTGEN_API_URL and ZITADEL_PROJECT_SECRET in your Vercel project
 * environment variables (`vercel env add`). For local `vercel dev`, they are
 * read from `.env.local`.
 */
import { handleProxy, resolveConfig } from "@zitadel/edge-proxy";

export const config = { matcher: ["/__nextgen", "/__nextgen/:path*"] };

const proxyConfig = resolveConfig({
  apiUrl: process.env.NEXTGEN_API_URL ?? "",
  projectSecret: process.env.ZITADEL_PROJECT_SECRET ?? "",
});

export default async function middleware(req: Request): Promise<Response | undefined> {
  return (await handleProxy(req, proxyConfig)) ?? undefined;
}
