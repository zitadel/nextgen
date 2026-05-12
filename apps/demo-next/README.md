# demo-next

A minimal Next.js application demonstrating [Nextgen Auth](../../packages/sdk-next) end-to-end: login, protected routes, and sign-out.

## Running locally

Start the mock auth backend and the demo in separate terminals:

```bash
# Terminal 1 — mock OIDC server on port 4000
pnpm --filter @nextgen/mockserver start

# Terminal 2 — Next.js app on port 3002
NEXTGEN_ISSUER_URL=http://localhost:4000 pnpm --filter @nextgen/demo-next dev
```

Open [http://localhost:3002/login](http://localhost:3002/login). Any email/password combination is accepted by the mock server.

## What it shows

| Route      | Behaviour                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| `/login`   | `<nextgen-login>` web component; redirects to `/admin` after sign-in     |
| `/admin`   | Protected — middleware redirects to `/login` if no valid session exists   |

## How it works

**Middleware** (`src/proxy.ts`) uses `nextgenMiddleware` from `@zitadel-nextgen/sdk-next` to proxy `/__nextgen/*` requests to the auth backend, verify the session JWT on every request, and redirect unauthenticated users away from `/admin`.

**Login page** renders the `<nextgen-login>` web component inside a client-only dynamic import to avoid SSR.

**Admin page** calls `auth()` on the server to read the verified session and display the signed-in user's email, with the `<nextgen-logout>` component in the header.

## Environment variables

| Variable             | Default                   | Description                    |
| -------------------- | ------------------------- | ------------------------------ |
| `NEXTGEN_ISSUER_URL` | `http://localhost:4000`   | URL of the Nextgen auth server |
