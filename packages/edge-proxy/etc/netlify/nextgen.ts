/**
 * Netlify Edge Function shim for @zitadel-nextgen/edge-proxy.
 *
 * Place this file at: netlify/edge-functions/nextgen.ts
 * Set NEXTGEN_API_URL via the Netlify dashboard or:
 *   netlify env:set NEXTGEN_API_URL https://your-backend.example.com
 *
 * Note: [vars] in netlify.toml is NOT available to edge functions.
 * The environment variable must be set through Netlify's UI or CLI.
 */
import { handleProxy, resolveConfig } from '@zitadel-nextgen/edge-proxy';
import type { Config } from '@netlify/edge-functions';

// Netlify.env is only available inside the handler at request time,
// not at module scope — resolve config per-request.
export default (req: Request): Promise<Response | null> =>
  handleProxy(
    req,
    resolveConfig({ apiUrl: Netlify.env.get('NEXTGEN_API_URL') ?? '' }),
  );

export const config: Config = { path: '/__nextgen/*' };
