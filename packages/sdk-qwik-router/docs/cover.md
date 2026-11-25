# @zitadel/sdk-qwik-router

The server half of the Zitadel SDK for Qwik 2 apps. It is a single Qwik Router `onRequest` handler plus a reader for what the handler decided, and it is for developers who already run a Qwik Router app and want sign-in, session checks and route protection without writing the auth plumbing. It has no components: the sign-in widgets come from `@zitadel/sdk-qwik`, and this package is what makes them work on the server.

## Main components

- {@link index.createZitadelOnRequest | createZitadelOnRequest} builds the `onRequest` handler you export from a root plugin such as `src/routes/plugin@zitadel.ts`. Use it once per app; it proxies, verifies and guards in one pass.
- {@link index.getAuth | getAuth} reads the auth result the handler left on the request. Call it in a `routeLoader$`, `routeAction$` or endpoint to learn who is signed in.
- {@link index.configureZitadel | configureZitadel}, {@link index.getApi | getApi} and {@link index.getZitadelConfig | getZitadelConfig} configure and read the project the SDK talks to. They are re-exported so an app that depends only on this package needs no other import for them.
- {@link index.QwikRequestEvent | QwikRequestEvent} is the slice of Qwik Router's `RequestEvent` the handler reads. You do not build one; it is documented so you can see exactly which fields the handler depends on.

## How it works

This package is not a wrapper around a custom element: it renders nothing, so there is no dynamic or compiled component to choose between, no `project-id` or `proxy-path` attribute in server-rendered markup, no custom element definition and no hydration step. Those belong to `@zitadel/sdk-qwik`, which renders `<zitadel-login>` and friends.

What this package does is run on every request, in this order:

1. It refuses any request that carries the internal `x-zitadel-auth-token` header with a `400`, because that header is an internal channel and clients never send it.
2. It skips paths matched by `ignoredRoutes`.
3. It proxies the same-origin `/__nextgen/*` path (the `proxyPath` option) to the Zitadel backend. The browser only ever talks to your app's origin, so the widgets need no CORS setup and the session cookie stays first-party. The project secret is attached as a bearer only on the session handoff exchange and never reaches the browser.
4. For every other request it judges the session, stores the result on `ev.sharedMap` for {@link index.getAuth | getAuth}, applies the session cookies the verdict asks for, and on a protected route with nobody signed in redirects to `loginPath` with the requested path in `?next=`. When the backend cannot say whether the session is live, a protected route answers `503` instead of sending a possibly signed-in user to the login page.

The `url`, project secret and project id are read per request from Qwik Router's `ev.env`, where Vite loads `.env` and `.env.local`, and then from `process.env`. They are not read once when the handler is built, because Qwik does not put `.env` files on `process.env`.

`protectedRoutes` guards full page loads. Client-side `<Link>` navigation does not load the page from the server, so guard those routes with a `routeLoader$` that calls {@link index.getAuth | getAuth}.

## Edge runtimes

The handler is written against Web standards only (`Request`, `Response`, `fetch`, `AbortSignal.timeout`, Web Crypto) and reads `process.env` defensively, so the entry loads on Cloudflare Workers and Vercel Edge, where there is no DOM and `process` may be missing. The shared edge cases run against the built package in the edge-runtime VM: a protected route redirects to the login path, the proxy path is forwarded to the backend with its method kept, a request carrying the internal auth header is refused before anything is forwarded, and an unprotected route passes through. Because the package renders no markup, there is nothing else to render on the server and nothing that is browser-only here; the widgets' server and browser behaviour is documented in `@zitadel/sdk-qwik`.

## Where to go next

- The [README on GitHub](https://github.com/zitadel/nextgen/tree/main/packages/sdk-qwik-router#readme) has installation, the handler options table and setup steps.
- Start from {@link index.createZitadelOnRequest | createZitadelOnRequest}, then {@link index.getAuth | getAuth}.
