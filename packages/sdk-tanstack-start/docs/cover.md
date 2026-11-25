# @zitadel/sdk-tanstack-start

The Zitadel SDK for TanStack Start apps. It is for developers who want sign-in, sign-out and protected routes in a TanStack Start (React) app, wired by hand. It has two halves: a request middleware that runs on the server, and the React components that render Zitadel's login, logout and session widgets in the browser. A TanStack Start app needs no other Zitadel package, so under a strict package manager everything below can be imported from this one.

## Main components

Server, from `@zitadel/sdk-tanstack-start/server`:

- {@link server!createZitadelRequestMiddleware} builds the request-middleware handler you register in `src/start.ts`. Use it for every app: it proxies auth traffic, verifies the session and guards protected routes in one pass.
- {@link server!getAuth} reads the signed-in user from the context a server function receives. Use it in a server function, and call that function from a route's `beforeLoad` to guard the route.
- {@link server!handleZitadelRequest} is the same proxy, verify and protect decision as a plain function from a `Request` to a {@link server!ZitadelRequestDecision}. Use it when you wire a custom server entry instead of TanStack Start's middleware.

Client, from `@zitadel/sdk-tanstack-start/client`:

- {@link client!configureZitadel} builds the `project` handle the widgets take. Use it once, with your project id and the proxy path.

Browser, from `@zitadel/sdk-tanstack-start/components`:

- {@link components!ZitadelLogin} renders the sign-in and sign-up widget. Use it on your login and register pages.
- {@link components!ZitadelSession} renders the "signed in as" card with a sign-out button. Use it on a profile page.
- {@link components!ZitadelLogout} renders a sign-out control on its own.

## How it works

The wrappers are not compiled to static markup and the package defines no elements itself. They are `@zitadel/sdk-react`'s components, which wrap the web components `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` from `@zitadel/components`, so the React and TanStack Start wrappers cannot drift apart. The `project` handle is bound as a DOM property and the widget's `zitadel-*` events surface as typed callbacks.

TanStack Start server-renders every route, and the server markup for a widget would carry none of its props. The browser defines the elements before React hydrates, so a server-rendered `<zitadel-login>` would upgrade with the element defaults (purpose `login`, no project) and start a flow before hydration applied the real props. The three components here therefore render nothing on the server and during hydration, and mount the widget right after, with every prop in place before the element starts its flow. On a client-side navigation they mount at once. The element definitions exist only in the browser.

The widgets talk to your auth backend through the same-origin `/__nextgen` proxy, which the request middleware serves: the `proxyPath` option sets the prefix, and the project secret is attached only to the session handoff, never sent to the browser. The middleware also verifies the session JWT against the backend's JWKS, places the result on the request context as `zitadelAuth`, and redirects signed-out visitors on protected routes to the login path. A session counts only in the app's own project.

## Edge runtimes

The server entries run on Cloudflare Workers and Vercel Edge. The middleware needs no Node built-ins: it verifies the JWT with the Web Crypto API, reaches the backend with `fetch`, and reads `process.env` only when `process` exists, so omitting `url` or `projectSecret` falls back to defaults instead of throwing. It is exercised in the package's edge test with the client address supplied through `clientAddress`, since an edge runtime hands the address over rather than the middleware reading a header.

The `/react` entry loads without a DOM: `@zitadel/components` has an edge build with no element definitions, importing it does nothing there, and the components render nothing on the server in any runtime. So on the edge the server response contains the page without the widgets, and the widgets appear once the browser has hydrated.

## Where to go next

- The [README on GitHub](https://github.com/zitadel/nextgen/tree/main/packages/sdk-tanstack-start#readme) has the install steps and the full middleware option table.
- Start from {@link server!createZitadelRequestMiddleware} for the server and {@link components!ZitadelLogin} for the browser.
