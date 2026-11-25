# @zitadel/sdk-solid-start

The server half of Zitadel for SolidStart apps. It is a request middleware, not
a component library: it proxies the browser's calls to your Zitadel server,
checks the session on every request, and lets your server functions and routes
ask who is signed in. It is for developers building a SolidStart app that signs
its users in through Zitadel. The login and sign-out widgets live in
`@zitadel/sdk-solid`; this package supplies what they talk to.

## Main components

- {@link index!createZitadelMiddleware} builds the middleware config. Wrap it in
  SolidStart's `createMiddleware` and register it with the `solidStart()`
  plugin; use it once per app.
- {@link index!getAuth} reads the session verdict the middleware stored, inside a
  server function or route, so you can guard data and pages.
- {@link index!configureZitadel}, {@link index!getApi} and {@link index!getZitadelConfig} set up
  and read the typed Zitadel API client (also exported from the `./client`
  entry, so an app needs only this one dependency).
- {@link index!SolidMiddlewareConfig} and {@link index!SolidFetchEvent} type the config and
  the slice of SolidStart's request event the middleware touches.
- {@link index!AuthResult}, {@link index!ZitadelAuthSession}, {@link index!ZitadelMiddlewareOptions}
  and the other session and option types describe what `getAuth` returns and
  what the middleware accepts.

## How it works

`createZitadelMiddleware` returns a plain `{ onRequest }` config, and on
SolidStart 2 it only takes effect inside `createMiddleware`, which turns it into
the array of h3 middleware SolidStart registers. One handler then does three
things for each request. It refuses any request that already carries the
internal `x-zitadel-auth-token` header. It forwards everything under the proxy
path (`/__nextgen` by default) to your Zitadel server, so the browser only ever
talks to the app's own origin; the project secret is attached only to the
session handoff exchange and never reaches the browser, and the session cookie
is renamed per project on the way through. Every other request has its session
verified against the server's keys and the verdict written to
`event.locals.zitadelAuth`, which {@link index!getAuth} reads. A protected route with
no session redirects to the login path with the requested path in `?next=`; if
the server cannot say whether the session is live, the route answers `503`
instead of sending a signed-in user to the login page.

The package renders no markup of its own, so nothing from it appears in
server-rendered HTML and there is nothing to hydrate. Render the widgets with
`@zitadel/sdk-solid`, loaded client-only, and point their `proxy-path` at the
same path the middleware proxies.

## Edge runtimes

The entries use only Web APIs (`fetch`, `Request`, `Response`, Web Crypto) and
read `process.env` defensively, so they load and run without a DOM or Node
built-ins on Cloudflare Workers and Vercel Edge. The middleware is exercised
inside the edge runtime against the built package. Because the entries load no
custom elements, nothing here needs a browser to import. Anything that does
need a DOM, such as the widgets, belongs in `@zitadel/sdk-solid`.

## Where to go next

Read the [README](https://github.com/zitadel/nextgen/tree/main/packages/sdk-solid-start#readme)
for installation, the middleware options table and the login-widget setup.
The API is split across three entries: the root re-exports everything,
`@zitadel/sdk-solid-start/server` holds the middleware, and
`@zitadel/sdk-solid-start/client` holds only the API configuration helpers.
