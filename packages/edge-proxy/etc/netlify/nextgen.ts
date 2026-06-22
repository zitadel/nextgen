/**
 * Netlify Edge Function shim for @zitadel/edge-proxy.
 *
 * Place this file at: netlify/edge-functions/nextgen.ts
 * Set NEXTGEN_API_URL and ZITADEL_PROJECT_SECRET via the Netlify dashboard or:
 *   netlify env:set NEXTGEN_API_URL https://your-backend.example.com
 *   netlify env:set ZITADEL_PROJECT_SECRET <secret>
 *
 * Note: [vars] in netlify.toml is NOT available to edge functions.
 * The environment variables must be set through Netlify's UI or CLI.
 */
import { handleProxy, resolveConfig } from "@zitadel/edge-proxy";
import type { Config } from "@netlify/edge-functions";

// Netlify.env is only available inside the handler at request time,
// not at module scope — resolve config per-request.
export default (req: Request): Promise<Response | null> =>
  handleProxy(
    req,
    resolveConfig({
      apiUrl: Netlify.env.get("NEXTGEN_API_URL") ?? "",
      projectSecret: Netlify.env.get("ZITADEL_PROJECT_SECRET") ?? "",
    }),
  );

export const config: Config = { path: "/__nextgen/*" };
