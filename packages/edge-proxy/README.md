# @zitadel/edge-proxy

A platform-agnostic edge proxy handler that lets React, Vue, and Angular SPAs call the Zitadel nextgen flow API without exposing backend URLs or fighting CORS.

Built entirely from WinterTC-standard web platform globals (`fetch`, `Request`, `Response`, `URL`, `Headers`). No platform-specific imports — the same handler runs on Cloudflare Workers, Vercel Edge Functions, and Netlify Edge Functions.

## Install

```bash
pnpm add @zitadel/edge-proxy
```

## How it works

The handler intercepts all `/__nextgen/*` requests from the browser, proxies them to your backend API, and streams the response back. Everything else (static assets, other routes) is left untouched.

- Project service-key injected as `Authorization: Bearer <secret>` from a server-side env var — the secret never reaches the browser
- Hop-by-hop headers stripped in both directions
- `X-Forwarded-*` headers injected when absent, preserved when already set by a CDN
- Multiple `Set-Cookie` headers preserved without collapsing
- 3xx redirects passed through unchanged
- Returns `null` for non-matching paths — lets the platform serve static assets

This secret injection is why a worker / edge function is required: a static rewrite rule (`vercel.json`, `netlify.toml`, Cloudflare `_redirects`) can route the path but cannot attach a secret env var to the upstream request.

## Setup

### Cloudflare Workers

1. Copy `etc/cloudflare/worker.ts` and `etc/cloudflare/wrangler.jsonc` to your project root.

2. Set your backend URL and project secret:

   ```bash
   wrangler secret put ZITADEL_PROJECT_SECRET
   # NEXTGEN_API_URL can be a plain var in wrangler.jsonc; the secret must not.
   # For local `wrangler dev`, put both in `.dev.vars` (gitignored).
   ```

3. Deploy:

   ```bash
   wrangler deploy
   ```

The worker uses `env.ASSETS.fetch(req)` for all non-`/__nextgen` requests, so your SPA static files are served normally.

> **Requirement:** `compatibility_date` must be `2025-01-01` or later for `Headers.getSetCookie()` support. The provided `wrangler.jsonc` already sets this.

---

### Vercel

1. Copy `etc/vercel/nextgen.ts` to `api/__nextgen/[...path].ts` in your project.

2. Copy `etc/vercel/vercel.json` to your project root (or merge with an existing one). The rewrite routes `/__nextgen/*` browser requests to the edge function — without it, the function only handles `/api/__nextgen/*` and the proxy will not intercept requests.

3. Set your backend URL and project secret in the Vercel dashboard or via CLI (read from `.env.local` under `vercel dev`):

   ```bash
   vercel env add NEXTGEN_API_URL
   vercel env add ZITADEL_PROJECT_SECRET
   ```

4. Deploy:

   ```bash
   vercel deploy
   ```

Vercel routes `/__nextgen/*` to the edge function via the rewrite and serves everything else from your SPA build output.

---

### Netlify

1. Copy `etc/netlify/nextgen.ts` to `netlify/edge-functions/nextgen.ts`.

2. Copy `etc/netlify/netlify.toml` to your project root (or merge with an existing one).

3. Set your backend URL and project secret — **must** use the Netlify dashboard or CLI, not `netlify.toml` vars (which are not available to edge functions):

   ```bash
   netlify env:set NEXTGEN_API_URL https://your-backend.example.com
   netlify env:set ZITADEL_PROJECT_SECRET <secret>
   ```

4. Deploy:

   ```bash
   netlify deploy --prod
   ```

---

## Configuration reference

```ts
import { resolveConfig, handleProxy } from '@zitadel/edge-proxy';

const config = resolveConfig({
  // Required. Base URL of the Zitadel nextgen API backend.
  apiUrl: 'https://api.example.com',

  // Optional. Project service-key. Attached as `Authorization: Bearer <secret>`
  // on every upstream request (unless one is already present). Read from a
  // server-side env var so it never reaches the browser.
  projectSecret: process.env.ZITADEL_PROJECT_SECRET,

  // Optional. URL path prefix to intercept. Default: '/__nextgen'
  pathPrefix: '/__nextgen',

  // Optional. Strip pathPrefix before forwarding. Default: true
  stripPrefix: true,

  // Optional. Headers injected into every upstream request.
  // Applied after hop-by-hop stripping; can override forwarded headers.
  additionalHeaders: {
    'X-Tenant-Id': 'acme',
  },
});

// In your handler:
const response = await handleProxy(request, config);
if (response) return response;
// else fall through to static assets
```

| Option | Type | Default | Description |
|---|---|---|---|
| `apiUrl` | `string` | — | Backend base URL (http or https). Required. |
| `projectSecret` | `string` | `''` | Project service-key. Attached as `Authorization: Bearer <secret>` unless one is already present. |
| `pathPrefix` | `string` | `'/__nextgen'` | Path prefix to intercept. Must start with `/`. |
| `stripPrefix` | `boolean` | `true` | Strip prefix before forwarding to upstream. |
| `additionalHeaders` | `Record<string, string>` | `{}` | Extra headers on every upstream request. |

`resolveConfig` throws `EdgeProxyConfigError` for invalid input (missing `apiUrl`, bad URL, non-http/s protocol, `pathPrefix` without a leading slash).
