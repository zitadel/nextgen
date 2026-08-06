# demo-next

A minimal Next.js application demonstrating [Nextgen Auth](../../packages/sdk-next) end-to-end: login, protected routes, and sign-out.

## Running locally

Use **Moon** from the repo root (`corepack pnpm install` first).

Build the SDK (and its transitive dependencies) once before the first run:

```bash
moon run sdk-next:build
```

### 1. Configure environment

Copy the example env file and adjust as needed:

```bash
cp apps/demo-next/.env.example apps/demo-next/.env.local
```

Or pass them inline when starting the dev server (step 2).

| Variable                          | Default                 | Description                                        |
| --------------------------------- | ----------------------- | -------------------------------------------------- |
| `ZITADEL_URL`                      | `http://localhost:8080` | URL of the Zitadel auth server                     |
| `NEXT_PUBLIC_ZITADEL_PROJECT_ID`  | `demo`                  | Project ID passed to `<zitadel-login project-id>`  |

### 2. Start

Two terminals:

```bash
# Terminal 1 — mock auth server on port 8080 (set PORT to override)
moon run api-mock:start

# Terminal 2 — Next.js on port 3002
moon run demo-next:dev

# …or with inline env overrides:
# ZITADEL_URL=https://my-instance.zitadel.cloud NEXT_PUBLIC_ZITADEL_PROJECT_ID=abc123 \
#   moon run demo-next:dev
```

Open [http://localhost:3002/login](http://localhost:3002/login). Any email/password combination is accepted by the mock server.

### Running against the Go server

Instead of the mock, you can run against the real Go server with embedded
Postgres. This gives you persistent state, real user creation, and the full
flow engine.

#### 1. Start the server

From the repo root:

```bash
moon run workspace:cli -- start
```

This builds the embedded console and login UIs, then starts the Go server on
`http://localhost:8080` with embedded Postgres (data stored in
`nextgen-data/`). The server is ready when you see
`Local Zitadel server is ready.`

#### 2. Create a project

```bash
curl -s -X POST http://localhost:8080/projects \
  -H 'Content-Type: application/json' \
  -d '{"name": "demo"}' | jq .
```

The response contains the `id` and `project_secret`:

```json
{
  "id": "proj_01JXXXXXXXXXXXXXXXX",
  "project_secret": "eyJhbGci..."
}
```

#### 3. Configure `.env.local`

Update `apps/demo-next/.env.local` with the values from step 2:

```env
ZITADEL_URL=http://localhost:8080
NEXT_PUBLIC_ZITADEL_PROJECT_ID=proj_01JXXXXXXXXXXXXXXXX
```

The demo only needs the project `id` — `project_secret` authenticates
server-side project-management calls and is not read by the demo app.

#### 4. Start demo-next

```bash
moon run demo-next:dev
```

Open [http://localhost:3002/login](http://localhost:3002/login). Use the
register flow to create a new user — unlike the mock, credentials are
persisted across restarts.

---

**UI-only iteration** (no Next.js, no TCP mock): the Storybook workbench runs
the Lit atoms, the paired React components, and the `<zitadel-login>`
orchestrator (MSW in the browser via `msw-storybook-addon`):

```bash
moon run storybook:dev
# → http://localhost:6006
```

After changing `@zitadel/components`, rebuild before refreshing:

```bash
moon run components:build
```

The demo imports the package from `dist/`, not source.

## What it shows

| Route      | Behaviour                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| `/login`   | `<zitadel-login>` web component; redirects to `/admin` after sign-in     |
| `/admin`   | Protected — middleware redirects to `/login` if no valid session exists   |

## How it works

**Middleware** (`src/proxy.ts`) uses `nextgenMiddleware` from `@zitadel/sdk-next` to proxy `/__nextgen/*` requests to the auth backend, verify the session JWT on every request, and redirect unauthenticated users away from `/admin`.

**Login page** renders the `<zitadel-login>` web component (from `@zitadel/components`) inside a client-only dynamic import to avoid SSR.

**Admin page** calls `auth()` on the server to read the verified session and display the signed-in user's email, with the `<zitadel-logout>` component in the header.

**Login widget** (`src/app/login/widget.tsx`) dynamically imports `@zitadel/components` with `ssr: false` so custom elements register only in the browser.

**Fonts and branding** — the mock server ships a default `font_url` (Arimo via Google Fonts) on every flow response. `<zitadel-login>` injects it as a `<link rel="stylesheet">` in the host document `<head>` — **not** the shadow root, because browsers ignore `@font-face` declared inside a shadow tree; the shadow DOM's `font-family` then resolves against the document-level face. Root `layout.tsx` sets `body { margin: 0; font-family: sans-serif; }`. Headings use the same Arimo family rendered bold (`--zl-font-family-heading` leads with `"Arimo"`). Tenants override the face via `branding.font_url`.
