/**
 * Cloudflare Workers shim for @zitadel-nextgen/edge-proxy.
 *
 * Copy this file to your project root alongside wrangler.jsonc,
 * then set NEXTGEN_API_URL in your wrangler.jsonc vars or via the dashboard.
 *
 * The worker intercepts /__nextgen/* requests and proxies them to the backend.
 * All other requests fall through to Cloudflare's static asset serving.
 */
import { handleProxy, resolveConfig } from '@zitadel-nextgen/edge-proxy';

interface Env {
  NEXTGEN_API_URL: string;
  ASSETS: Fetcher;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const config = resolveConfig({ apiUrl: env.NEXTGEN_API_URL });
    return (await handleProxy(req, config)) ?? env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
