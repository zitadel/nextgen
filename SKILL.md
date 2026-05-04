# Skill: Set up the nextgen edge proxy

**Trigger phrases:** "set up the nextgen proxy", "wire up edge-proxy", "add edge-proxy",
"set up /__nextgen proxy", "proxy nextgen through the edge"

## What this skill does

Installs `@zitadel-nextgen/edge-proxy` into a user's SPA project and wires up the
platform-specific shim so that `/__nextgen/*` browser requests are proxied to the Zitadel
nextgen API backend. Covers Cloudflare Workers, Vercel Edge Functions, and Netlify Edge Functions.

## Steps

### 1 — Detect the platform

Check the project root for these files:

| File | Platform |
|---|---|
| `wrangler.toml` or `wrangler.jsonc` | Cloudflare Workers |
| `vercel.json` or `.vercel/` directory | Vercel |
| `netlify.toml` | Netlify |

If none found, ask the user: "Which platform are you deploying to? (Cloudflare / Vercel / Netlify)"

### 2 — Install the package

```bash
pnpm add @zitadel-nextgen/edge-proxy
```

### 3 — Copy shim files

#### Cloudflare

Copy from the installed package (or the repo's `packages/edge-proxy/etc/cloudflare/`):

- `worker.ts` → project root
- `wrangler.jsonc` → project root (merge with existing if present)

Key things to check in `wrangler.jsonc`:
- `"compatibility_date"` must be `"2025-01-01"` or later
- `"assets.run_worker_first"` must include `"/__nextgen/*"`
- `"vars.NEXTGEN_API_URL"` should be set (or use `wrangler secret put NEXTGEN_API_URL`)

#### Vercel

Copy:
- `nextgen.ts` → `api/__nextgen/[...path].ts`

Set the env var: `vercel env add NEXTGEN_API_URL`

#### Netlify

Copy:
- `nextgen.ts` → `netlify/edge-functions/nextgen.ts`
- `netlify.toml` → project root (merge with existing if present)

Set the env var via dashboard or:
```bash
netlify env:set NEXTGEN_API_URL https://your-backend.example.com
```

> ⚠️ `[vars]` in `netlify.toml` is **not** available to edge functions. Must use the dashboard or CLI.

### 4 — Verify

Start the local dev server and check the proxy endpoint:

```bash
# Cloudflare
wrangler dev

# Vercel
vercel dev

# Netlify
netlify dev
```

Then test:
```bash
curl -v http://localhost:PORT/__nextgen/healthz
```

The request should be forwarded to your backend. If the backend isn't running, you should
see a connection error (not a 404), which confirms the routing is correct.

### 5 — Troubleshooting

| Symptom | Likely cause |
|---|---|
| 404 on `/__nextgen/*` | Shim file not in the right location, or route not wired in config |
| Cloudflare: cookies not preserved | `compatibility_date` is before `2025-01-01` |
| Netlify: `NEXTGEN_API_URL` undefined | Set via dashboard/CLI, not `netlify.toml` vars |
| CORS errors | Proxy is not intercepting — check the path prefix matches |
