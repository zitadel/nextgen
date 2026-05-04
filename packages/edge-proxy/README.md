# @zitadel-nextgen/edge-proxy

A platform-agnostic edge proxy handler that lets React, Vue, and Angular SPAs call the Zitadel nextgen flow API without exposing backend URLs or fighting CORS.

Built entirely from WinterTC-standard web platform globals (`fetch`, `Request`, `Response`, `URL`, `Headers`). No platform-specific imports — the same handler runs on Cloudflare Workers, Vercel Edge Functions, and Netlify Edge Functions.

## Install

```bash
pnpm add @zitadel-nextgen/edge-proxy
```

## How it works

The handler intercepts all `/__nextgen/*` requests from the browser, proxies them to your backend API, and streams the response back. Everything else (static assets, other routes) is left untouched.

- Hop-by-hop headers stripped in both directions
- `X-Forwarded-*` headers injected when absent, preserved when already set by a CDN
- Multiple `Set-Cookie` headers preserved without collapsing
- 3xx redirects passed through unchanged
- Returns `null` for non-matching paths — lets the platform serve static assets

## Setup

### Cloudflare Workers

1. Copy `etc/cloudflare/worker.ts` and `etc/cloudflare/wrangler.jsonc` to your project root.

2. Set your backend URL:

   ```bash
   wrangler secret put NEXTGEN_API_URL
   # or edit wrangler.jsonc vars for local dev
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

2. Set your backend URL in the Vercel dashboard or via CLI:

   ```bash
   vercel env add NEXTGEN_API_URL
   ```

3. Deploy:

   ```bash
   vercel deploy
   ```

Vercel routes `/__nextgen/*` to the edge function and serves everything else from your SPA build output.

---

### Netlify

1. Copy `etc/netlify/nextgen.ts` to `netlify/edge-functions/nextgen.ts`.

2. Copy `etc/netlify/netlify.toml` to your project root (or merge with an existing one).

3. Set your backend URL — **must** use the Netlify dashboard or CLI, not `netlify.toml` vars (which are not available to edge functions):

   ```bash
   netlify env:set NEXTGEN_API_URL https://your-backend.example.com
   ```

4. Deploy:

   ```bash
   netlify deploy --prod
   ```

---

## Configuration reference

```ts
import { resolveConfig, handleProxy } from '@zitadel-nextgen/edge-proxy';

const config = resolveConfig({
  // Required. Base URL of the Zitadel nextgen API backend.
  apiUrl: 'https://api.example.com',

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
| `pathPrefix` | `string` | `'/__nextgen'` | Path prefix to intercept. Must start with `/`. |
| `stripPrefix` | `boolean` | `true` | Strip prefix before forwarding to upstream. |
| `additionalHeaders` | `Record<string, string>` | `{}` | Extra headers on every upstream request. |

`resolveConfig` throws `EdgeProxyConfigError` for invalid input (missing `apiUrl`, bad URL, non-http/s protocol, `pathPrefix` without a leading slash).
