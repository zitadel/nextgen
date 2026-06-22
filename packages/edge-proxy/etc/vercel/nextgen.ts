/**
 * Vercel Edge Function shim for @zitadel/edge-proxy.
 *
 * Place this file at: api/__nextgen/[...path].ts
 * Then set NEXTGEN_API_URL and ZITADEL_PROJECT_SECRET in your Vercel project
 * environment variables (`vercel env add`). For local `vercel dev`, they are
 * read from `.env.local`.
 *
 * The function intercepts all /api/__nextgen/* requests and proxies them
 * to the backend. Vercel routes the rest to your SPA static files.
 */
import { handleProxy, resolveConfig } from "@zitadel/edge-proxy";

export const config = { runtime: "edge" };

const proxyConfig = resolveConfig({
  apiUrl: process.env["NEXTGEN_API_URL"] ?? "",
  projectSecret: process.env["ZITADEL_PROJECT_SECRET"] ?? "",
});

export default (req: Request): Promise<Response | null> => handleProxy(req, proxyConfig);
