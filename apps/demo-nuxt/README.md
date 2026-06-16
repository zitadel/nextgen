# demo-nuxt

A minimal Nuxt application demonstrating [Nextgen Auth](../../packages/sdk-nuxt) end-to-end: login, protected routes, and sign-out.

## Running locally

Use **Nx** from the repo root (`corepack pnpm install` first).

Build the SDK (and its transitive dependencies) once before the first run:

```bash
corepack pnpm nx build @zitadel/sdk-nuxt
```

### 1. Configure environment

Copy the example env file and adjust as needed:

```bash
cp apps/demo-nuxt/.env.example apps/demo-nuxt/.env
```

Or pass them inline when starting the dev server (step 2).

| Variable                          | Default                 | Description                                        |
| --------------------------------- | ----------------------- | -------------------------------------------------- |
| `ZITADEL_URL`                      | `http://localhost:4000` | URL of the Zitadel auth server                     |
| `NUXT_PUBLIC_ZITADEL_PROJECT_ID`  | `demo`                  | Project ID passed to `<zitadel-login project-id>`  |

### 2. Start

Two terminals:

```bash
# Terminal 1 — mock auth server on port 4000
corepack pnpm nx start @zitadel/api-mock

# Terminal 2 — Nuxt on port 3001
corepack pnpm nx dev @zitadel/demo-nuxt

# …or with inline env overrides:
# ZITADEL_URL=https://my-instance.zitadel.cloud NUXT_PUBLIC_ZITADEL_PROJECT_ID=abc123 \
#   corepack pnpm nx dev @zitadel/demo-nuxt
```

Open [http://localhost:3001/login](http://localhost:3001/login). Any email/password combination is accepted by the mock server.

**UI-only iteration** (no Nuxt, no TCP mock):

```bash
corepack pnpm nx dev @zitadel/components
# → http://localhost:5173/?route=login
# → http://localhost:5173/?route=atoms

corepack pnpm nx dev @zitadel/console
# → http://localhost:5174
```

After changing `@zitadel/components`, rebuild before refreshing:

```bash
corepack pnpm nx build @zitadel/components
```

The demo imports the package from `dist/`, not source.

## What it shows

| Route    | Behaviour                                                                  |
| -------- | -------------------------------------------------------------------------- |
| `/login` | `<zitadel-login>` web component; redirects to `/admin` after sign-in      |
| `/admin` | Protected — middleware redirects to `/login` if no valid session exists    |

## How it works

**Server middleware** (`server/middleware/auth.ts`) uses `createNextgenMiddleware` from `@zitadel/sdk-nuxt` to proxy `/__nextgen/*` requests to the auth backend, verify the session JWT on every request, and redirect unauthenticated users away from `/admin`.

**Plugin** (`plugins/auth.server.ts`) reads the verified auth context from the server event and writes it into Nuxt's shared `nextgen-auth` state so pages can access it without additional fetches.

**Login page** renders the `<zitadel-login>` web component (from `@zitadel/components`) inside `<ClientOnly>` to avoid SSR.

**Admin page** reads `useState('nextgen-auth')` to display the signed-in user's email, with the `<zitadel-logout>` component in the header.

**Client plugins** (do not import `@zitadel/components` from page `<script setup>` — that runs during SSR and breaks hydration/fonts):

| Plugin | Role |
| ------ | ---- |
| `plugins/zitadel-components.client.ts` | Registers `<zitadel-login>` and `<zitadel-logout>` on the client |
| `plugins/auth.server.ts` | Seeds `useState('nextgen-auth')` from verified middleware context |

**Fonts and branding** — same as demo-next: the mock server applies `defaultDevBranding` (Arimo `font_url`), and `<zitadel-login>` injects it as a `<link rel="stylesheet">` in the host document `<head>` — **not** the shadow root, since browsers ignore `@font-face` declared inside a shadow tree; the shadow DOM's `font-family` resolves against the document-level face. `assets/css/demo-host.css` sets host `body` styles to match Next's `layout.tsx`. Headings use the same Arimo family rendered bold; tenants override the face via `branding.font_url`.
