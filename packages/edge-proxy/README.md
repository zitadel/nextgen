# @zitadel/edge-proxy

A platform-agnostic edge proxy handler that lets any SPA (React, Vue, Angular, Solid, Svelte, Qwik, …) call the Zitadel nextgen flow API without exposing backend URLs or fighting CORS. The handler itself is framework-agnostic; the `zitadel` CLI scaffolds it for each supported SPA framework.

Built entirely from WinterTC-standard web platform globals (`fetch`, `Request`, `Response`, `URL`, `Headers`). No platform-specific imports — the same handler runs on Cloudflare Workers, Vercel Edge Functions, and Netlify Edge Functions.

> The `zitadel` CLI scaffolds equivalent files for you when you run `setup` in an SPA project with a platform CLI installed (it may use different filenames, e.g. `zitadel-edge-proxy.ts`). The steps below are for wiring it up by hand.

## Install

```bash
pnpm add @zitadel/edge-proxy
```

## How it works

The handler intercepts all `/__nextgen/*` requests from the browser, proxies them to your backend API, and streams the response back. Everything else (static assets, other routes) is left untouched.

- Project service-key injected as `Authorization: Bearer <secret>` from a server-side env var — the secret never reaches the browser. Any client-supplied `Authorization` is stripped first, so the browser can't control the upstream credential.
- Hop-by-hop headers stripped in both directions
- `X-Forwarded-*` headers injected when absent, preserved when already set by a CDN
- Multiple `Set-Cookie` headers preserved without collapsing
- `redirect: 'manual'`, and on 3xx responses the upstream `Location` header is stripped so internal backend URLs never leak — a 3xx status is forwarded without its redirect target, while `Location` on other statuses (e.g. `201 Created`) is preserved
- Upstream timeout returns `504`, connection failure returns `502`
- Returns `null` for non-matching paths — lets the platform serve static assets

This secret injection is why a worker / edge function is required: a static rewrite rule (`vercel.json`, `netlify.toml`, Cloudflare `_redirects`) can route the path but cannot attach a secret env var to the upstream request.

## Setup

Cloudflare and Netlify intercept `/__nextgen/*` directly (so the default `pathPrefix` matches); Vercel routes it to an edge function via a `vercel.json` rewrite, and the function is configured with the matching prefix.

### Cloudflare Workers

1. Copy `etc/cloudflare/worker.ts` and `etc/cloudflare/wrangler.jsonc` to your project root, and set `assets.directory` to your SPA build output.

2. Set the secret (the backend URL stays a plaintext `var` in `wrangler.jsonc`):

   ```bash
   wrangler secret put ZITADEL_PROJECT_SECRET
   # For local `wrangler dev`, put both NEXTGEN_API_URL and the secret in .dev.vars (gitignored).
   ```

3. Deploy:

   ```bash
   wrangler deploy
   ```

The worker serves all non-`/__nextgen` requests via the `ASSETS` binding, so your SPA static files are served normally.

> **Requirement:** `compatibility_date` must be `2025-01-01` or later for `Headers.getSetCookie()` support, and `assets.binding` must be set so the worker can reach the static files. The provided `wrangler.jsonc` already sets both.

---

### Vercel

1. Copy `etc/vercel/nextgen.ts` to `api/__nextgen/[...path].ts` and `etc/vercel/vercel.json` to your project root (merge the `rewrites` if you already have one). The rewrite forwards `/__nextgen/*` to the edge function, which is configured with `pathPrefix: "/api/__nextgen"` so it matches the rewritten path.

2. Set the backend URL and secret (read from `.env.local` under `vercel dev`):

   ```bash
   vercel env add NEXTGEN_API_URL
   vercel env add ZITADEL_PROJECT_SECRET
   ```

3. Deploy:

   ```bash
   vercel deploy
   ```

---

### Netlify

1. Copy `etc/netlify/nextgen.ts` to `netlify/edge-functions/nextgen.ts`. Netlify auto-discovers functions in that directory and routes this one via its inline `config.path` — no `netlify.toml` entry needed.

2. Set the backend URL and secret. `netlify dev` reads them from `.env`; for deploys use the dashboard or CLI (edge functions don't see `netlify.toml` `[vars]`):

   ```bash
   netlify env:set NEXTGEN_API_URL https://your-backend.example.com
   netlify env:set ZITADEL_PROJECT_SECRET <secret>
   ```

3. Deploy:

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

  // Optional. Project service-key, attached as `Authorization: Bearer <secret>`
  // on every upstream request. Client-supplied Authorization is stripped first.
  // Read from a server-side env var so it never reaches the browser.
  projectSecret: process.env.ZITADEL_PROJECT_SECRET,

  // Optional. URL path prefix to intercept. Default: '/__nextgen'
  pathPrefix: '/__nextgen',

  // Optional. Strip pathPrefix before forwarding. Default: true
  stripPrefix: true,

  // Optional. Headers injected into every upstream request.
  // Applied after hop-by-hop stripping; can override forwarded headers,
  // including Authorization if you need a custom credential.
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
| `projectSecret` | `string` | `''` | Project service-key. Attached as `Authorization: Bearer <secret>` after stripping any client Authorization, unless `additionalHeaders` sets one. |
| `pathPrefix` | `string` | `'/__nextgen'` | Path prefix to intercept. Must start with `/`. |
| `stripPrefix` | `boolean` | `true` | Strip prefix before forwarding to upstream. |
| `additionalHeaders` | `Record<string, string>` | `{}` | Extra headers on every upstream request. |
| `proxyTimeoutMs` | `number` | `5000` | Upstream request timeout in ms. On timeout the proxy returns `504`. |

`resolveConfig` throws `EdgeProxyConfigError` for invalid input (missing `apiUrl`, bad URL, non-http/s protocol, `pathPrefix` without a leading slash).
