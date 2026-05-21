# demo-next

A minimal Next.js application demonstrating [Nextgen Auth](../../packages/sdk-next) end-to-end: login, protected routes, and sign-out.

## Running locally

Use **Nx** from the repo root (`corepack pnpm install` first). Two terminals:

```bash
# Terminal 1 — mock auth server on port 4000
corepack pnpm nx start @zitadel-nextgen/api-mock

# Terminal 2 — Next.js on port 3002
NEXTGEN_ISSUER_URL=http://localhost:4000 corepack pnpm nx dev @nextgen/demo-next
```

Open [http://localhost:3002/login](http://localhost:3002/login). Any email/password combination is accepted by the mock server.

**UI-only iteration** (no Next.js, no TCP mock): MSW runs in the browser on these dev servers:

```bash
# Lit atoms + <zitadel-login> (source from packages/components/src)
corepack pnpm nx dev @zitadel-nextgen/components
# → http://localhost:5173/?route=login
# → http://localhost:5173/?route=atoms

# React paired atoms (@zitadel-nextgen/ui-react) — compare Lit matrices in another tab
corepack pnpm nx dev @zitadel-nextgen/console
# → http://localhost:5174
```

After changing `@zitadel-nextgen/components`, rebuild before refreshing:

```bash
corepack pnpm nx build @zitadel-nextgen/components
```

The demo imports the package from `dist/`, not source.

## What it shows

| Route      | Behaviour                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| `/login`   | `<zitadel-login>` web component; redirects to `/admin` after sign-in     |
| `/admin`   | Protected — middleware redirects to `/login` if no valid session exists   |

## How it works

**Middleware** (`src/proxy.ts`) uses `nextgenMiddleware` from `@zitadel-nextgen/sdk-next` to proxy `/__nextgen/*` requests to the auth backend, verify the session JWT on every request, and redirect unauthenticated users away from `/admin`.

**Login page** renders the `<zitadel-login>` web component (from `@zitadel-nextgen/components`) inside a client-only dynamic import to avoid SSR.

**Admin page** calls `auth()` on the server to read the verified session and display the signed-in user's email, with the `<zitadel-logout>` component in the header.

**Login widget** (`src/app/login/widget.tsx`) dynamically imports `@zitadel-nextgen/components` with `ssr: false` so custom elements register only in the browser.

**Fonts and branding** — the mock server ships a default `font_url` (Arimo via Google Fonts) on every flow response. `<zitadel-login>` injects it into its shadow root. Root `layout.tsx` sets `body { margin: 0; font-family: sans-serif; }`. **APK Futural** in heading tokens still needs a tenant font URL when you brand beyond the mock baseline.

## Environment variables

| Variable             | Default                   | Description                    |
| -------------------- | ------------------------- | ------------------------------ |
| `NEXTGEN_ISSUER_URL` | `http://localhost:4000`   | URL of the Nextgen auth server |
