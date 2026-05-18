# demo-nuxt

A minimal Nuxt application demonstrating [Nextgen Auth](../../packages/sdk-nuxt) end-to-end: login, protected routes, and sign-out.

## Running locally

Start the mock auth backend and the demo in separate terminals:

```bash
# Terminal 1 — mock auth server on port 4000
pnpm --filter @zitadel-nextgen/api-mock start

# Terminal 2 — Nuxt app on port 3001
NEXTGEN_ISSUER_URL=http://localhost:4000 pnpm --filter @nextgen/demo-nuxt dev
```

Open [http://localhost:3001/login](http://localhost:3001/login). Any email/password combination is accepted by the mock server.

## What it shows

| Route    | Behaviour                                                                  |
| -------- | -------------------------------------------------------------------------- |
| `/login` | `<zitadel-login>` web component; redirects to `/admin` after sign-in      |
| `/admin` | Protected — middleware redirects to `/login` if no valid session exists    |

## How it works

**Server middleware** (`server/middleware/auth.ts`) uses `createNextgenMiddleware` from `@nextgen/sdk-nuxt` to proxy `/__nextgen/*` requests to the auth backend, verify the session JWT on every request, and redirect unauthenticated users away from `/admin`.

**Plugin** (`plugins/auth.server.ts`) reads the verified auth context from the server event and writes it into Nuxt's shared `nextgen-auth` state so pages can access it without additional fetches.

**Login page** renders the `<zitadel-login>` web component (from `@zitadel-nextgen/components`) inside `<ClientOnly>` to avoid SSR.

**Admin page** reads `useState('nextgen-auth')` to display the signed-in user's email, with the `<zitadel-logout>` component in the header.

## Environment variables

| Variable             | Default                 | Description                    |
| -------------------- | ----------------------- | ------------------------------ |
| `NEXTGEN_ISSUER_URL` | `http://localhost:4000` | URL of the Nextgen auth server |
