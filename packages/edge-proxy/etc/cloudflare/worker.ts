/**
 * Cloudflare Workers shim for @zitadel/edge-proxy.
 *
 * Copy this file to your project root alongside wrangler.jsonc,
 * then set NEXTGEN_API_URL in your wrangler.jsonc vars or via the dashboard.
 *
 * ZITADEL_PROJECT_SECRET must be set as an ENCRYPTED secret, never as a plain
 * var in wrangler.jsonc (which would commit it):
 *   wrangler secret put ZITADEL_PROJECT_SECRET
 * For local `wrangler dev`, put it in `.dev.vars` (gitignored).
 *
 * The worker intercepts /__nextgen/* requests and proxies them to the backend.
 * All other requests fall through to Cloudflare's static asset serving.
 */
import { handleProxy, resolveConfig } from "@zitadel/edge-proxy";

interface Env {
  NEXTGEN_API_URL: string;
  ZITADEL_PROJECT_SECRET: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const config = resolveConfig({
      apiUrl: env.NEXTGEN_API_URL,
      projectSecret: env.ZITADEL_PROJECT_SECRET,
    });
    return (await handleProxy(req, config)) ?? env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
