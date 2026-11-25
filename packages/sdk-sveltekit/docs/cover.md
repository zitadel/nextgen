# @zitadel/sdk-sveltekit

The server side of Zitadel sign-in for SvelteKit 3. It is a `handle` hook plus
a few helpers: the hook proxies the auth backend same-origin, verifies the
session on every request, and guards the routes you mark as protected. It is
for developers wiring Zitadel into a SvelteKit app by hand; the `zitadel setup`
CLI scaffolds the same wiring for a new project. The login and session
widgets are built in `@zitadel/sdk-svelte`, and this package re-exports them from
`@zitadel/sdk-sveltekit/components`, so an app imports everything for SvelteKit
from one package.

## Main components

- {@link server!createZitadelHandle} builds the `handle` hook for `src/hooks.server.ts`.
  Use it once per app; compose it with your own hooks through `sequence()`.
- {@link server!getAuth} reads the verified auth state from a request event in a load
  function, endpoint or action, after the hook has run.
- {@link server!ZitadelHandle} is the type of the hook, so it can be composed and
  typed without importing it from SvelteKit.
- {@link server!ZitadelMiddlewareOptions} lists every setting the hook accepts
  (`url`, `projectId`, `protectedRoutes`, `loginPath`, token checks, timeouts).
- {@link server!ZitadelAuthResult} is what `getAuth` returns: signed in with a session, or
  not signed in.
- {@link client!configureZitadel}, {@link client!getApi} and {@link client!getZitadelConfig}, from
  `@zitadel/sdk-sveltekit/client`, configure the browser API client before a
  widget mounts.

## How it works

The hook renders no markup. The widgets come from the components entry, which
re-exports them. The hook sits in front of every request:

- `/__nextgen/*` is forwarded to your Zitadel server, so the browser only ever
  talks to your own origin. The project secret is attached as the bearer on
  the `POST /sessions/exchange` handoff alone and never reaches the browser.
- Every other request has its session token verified against the server's
  JWKS with Web Crypto, and the result is written to `event.locals.zitadelAuth`.
  `App.Locals` is augmented for you, so {@link server!getAuth} is typed.
- On a protected route with no valid session the hook redirects to `loginPath`
  with the requested path in `?next=`. If the backend cannot say whether the
  session is live, the route answers `503` instead of sending a signed-in
  user to the login page.
- Protection covers full page loads. Client-side navigation does not reach the
  hook, so guard such pages with a load function that calls {@link server!getAuth}.

The hook settings are read from the options you pass; when left out, `url`,
`projectSecret` and `projectId` fall back to `process.env`, which SvelteKit
does not fill from `.env` files, so pass them from `$app/env/private`.

## Edge runtimes

The hook uses only Web APIs: `fetch`, Web Crypto and `AbortSignal.timeout`. It
imports no Node module and needs no DOM, and it reads `process.env` only if
`process` exists. It therefore loads and runs on Cloudflare Workers and other
edge adapters, and the package's edge spec runs it against the built output.
The client entry only re-exports the API configuration helpers and renders
nothing, and so does the server entry. Only the components entry holds widgets.

## Where to go next

- The [README](https://github.com/zitadel/nextgen/tree/main/packages/sdk-sveltekit#readme)
  has install and setup steps.
- Start from {@link server!createZitadelHandle}, then {@link server!getAuth}.
