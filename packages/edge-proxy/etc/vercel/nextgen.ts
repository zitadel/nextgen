/**
 * Vercel Edge Function shim for @zitadel/edge-proxy.
 *
 * Place this file at: api/__nextgen/[...path].ts, and copy vercel.json (the
 * rewrite) to your project root. The rewrite forwards `/__nextgen/*` to this
 * function, which Vercel invokes at `/api/__nextgen/*` — so the proxy is
 * configured with `pathPrefix: "/api/__nextgen"` to match that path.
 *
 * Set NEXTGEN_API_URL and ZITADEL_PROJECT_SECRET in your Vercel project
 * environment variables (`vercel env add`). For local `vercel dev`, they are
 * read from `.env.local`.
 */
import { handleProxy, resolveConfig } from "@zitadel/edge-proxy";

export const config = { runtime: "edge" };

const proxyConfig = resolveConfig({
  apiUrl: process.env["NEXTGEN_API_URL"] ?? "",
  projectSecret: process.env["ZITADEL_PROJECT_SECRET"] ?? "",
  pathPrefix: "/api/__nextgen",
});

export default (req: Request): Promise<Response | null> => handleProxy(req, proxyConfig);
