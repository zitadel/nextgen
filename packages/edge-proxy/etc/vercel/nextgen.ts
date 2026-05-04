/**
 * Vercel Edge Function shim for @zitadel-nextgen/edge-proxy.
 *
 * Place this file at: api/__nextgen/[...path].ts
 * Then set NEXTGEN_API_URL in your Vercel project environment variables.
 *
 * The function intercepts all /api/__nextgen/* requests and proxies them
 * to the backend. Vercel routes the rest to your SPA static files.
 */
import { handleProxy, resolveConfig } from '@zitadel-nextgen/edge-proxy';

export const config = { runtime: 'edge' };

const proxyConfig = resolveConfig({
  apiUrl: process.env['NEXTGEN_API_URL'] ?? '',
});

export default (req: Request): Promise<Response | null> =>
  handleProxy(req, proxyConfig);
