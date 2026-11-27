# @zitadel/sdk-next

Next.js middleware, server helpers and React components for signing users in with Zitadel. It is for developers building a Next.js App Router application (Next.js 15.2.3 or later) who want the same-origin sign-in flow, session checks in Server Components and a hook for client components, without wiring the Zitadel API and the `<zitadel-*>` web components together by hand.

The package is split into entry points because Next.js runs code in three places and each place may import only some of it. Pick the entry by where your code runs:

| Your code runs in | Import from | You get |
| --- | --- | --- |
| Middleware (`proxy.ts` on Next.js 16, `middleware.ts` on 15) | `@zitadel/sdk-next/middleware` | {@link middleware!zitadelMiddleware | zitadelMiddleware}, {@link middleware!createProxy | createProxy} |
| Server Components and Route Handlers | `@zitadel/sdk-next/server` | {@link server!auth | auth}, {@link server!ZitadelProvider | ZitadelProvider} |
| Client Components that read the session | `@zitadel/sdk-next/react` | {@link react!useAuth | useAuth}, {@link react!AuthContextProvider | AuthContextProvider} |
| Client Components that fetch the session themselves | `@zitadel/sdk-next/session` | {@link session!getSession | getSession} |
| Client Components that render the sign-in widgets | `@zitadel/sdk-next/components` | {@link components!ZitadelLogin | ZitadelLogin}, {@link components!ZitadelLogout | ZitadelLogout}, {@link components!ZitadelSession | ZitadelSession} |
| A client boundary that only registers the widgets and configures the SDK | `@zitadel/sdk-next/client` | {@link client!configureZitadel | configureZitadel} |

The package root, `@zitadel/sdk-next`, re-exports the server surface and the client-safe hooks together. Import it only from server modules: it includes the server-only {@link server!auth | auth}, so a `"use client"` module that imports it fails the build. There is also a types-only `@zitadel/sdk-next/jsx` entry, which adds the JSX typings of the `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` elements for apps that use the raw elements instead of the wrappers; it declares no values, so it has no page in this reference.

## Main components

- {@link middleware!zitadelMiddleware | zitadelMiddleware} runs in Next.js middleware. In one pass it proxies `/__nextgen/*` to Zitadel, verifies the session cookie and redirects visitors to your login page when they ask for a route in `protectedRoutes`. Use it as the single middleware of the app.
- {@link middleware!createProxy | createProxy} builds that same middleware from the handle `configureZitadel()` returns, so the project and URL are configured once. Use it when the app already calls `configureZitadel()`.
- {@link server!auth | auth} reads and verifies the session in a Server Component or Route Handler. It returns the raw session token, so keep it on the server.
- {@link server!ZitadelProvider | ZitadelProvider} seeds client components with the signed-in state. It strips the token before anything crosses to the browser, which is why it is server-only.
- {@link react!useAuth | useAuth} reads the state {@link server!ZitadelProvider | ZitadelProvider} seeded, in any Client Component.
- {@link session!getSession | getSession} asks the server who is signed in, from the browser. Use it for headers and account menus on pages the middleware `matcher` does not cover, where {@link server!auth | auth} cannot see the session.
- {@link components!ZitadelLogin | ZitadelLogin}, {@link components!ZitadelLogout | ZitadelLogout} and {@link components!ZitadelSession | ZitadelSession} render the sign-in flow, a sign-out button and a signed-in card. Use them instead of the raw custom elements.
- {@link client!configureZitadel | configureZitadel} creates the project handle (project id and proxy path) that the widgets and {@link middleware!createProxy | createProxy} take.

## How it works

The session lives in a cookie on your own origin. {@link middleware!zitadelMiddleware | zitadelMiddleware} proxies `/__nextgen/*` to the Zitadel backend, so the browser, the widgets and {@link session!getSession | getSession} only ever talk to your app, never to Zitadel directly. It then checks the cookie (a JWT through the JWKS, an opaque token against the backend) and passes the token to the server render in the internal `x-zitadel-auth-token` request header. The middleware is the only writer of that header and refuses any request that sends it. {@link server!auth | auth} reads it and verifies it again, so a header on a route the `matcher` does not cover proves nothing.

The widget wrappers come from `@zitadel/sdk-react` and are static: they are `@lit/react` components created once when the module loads, not built at render time, and they render the `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` custom elements. They set `project` and `locales` as DOM properties on both React 18 and React 19, including after hydration, where the raw elements lose them or serialise `[object Object]`. The keys that define a widget's first flow, the `project-id` and `proxy-path` of a handle without a publishable key, are rendered as plain attributes, so they are in the server-rendered markup and are there when the element upgrades before hydration. A handle that carries a publishable key cannot be written as attributes, so the wrapper renders nothing on the server and creates the element after mount. The element definitions themselves, and everything the widgets draw, exist only in the browser: the server-rendered markup holds the custom-element tags and their attributes, not the sign-in form. The README imports the wrapper behind `next/dynamic` with `ssr: false`, which skips the server markup altogether. Call {@link client!configureZitadel | configureZitadel} in the client boundary before the widgets mount.

Client components never see the session token. {@link server!ZitadelProvider | ZitadelProvider} converts the {@link server!auth | auth} result to the client-safe shape (`userId`, `identifier`, `identifierProperty`, `display`) on the server, and {@link session!getSession | getSession} returns the same shape. {@link react!AuthContextProvider | AuthContextProvider} accepts only that token-less shape.

## Edge runtimes

The middleware is built for the edge: it uses the Web Crypto API and `fetch`, with no Node-only modules, so it runs in the Next.js edge runtime on Vercel and on Cloudflare Workers. The {@link server!auth | auth} and {@link server!ZitadelProvider | ZitadelProvider} entry points load there too. The `/client` entry also loads without a DOM: on an edge runtime the components package resolves to a build without the custom elements, so importing it registers nothing and does not throw. The widgets are drawn by the browser, so what an edge render produces is the page around them, plus the element tags and their attributes. The widgets, {@link session!getSession | getSession} (which throws outside a browser) and the hooks that need a browser run only on the client.

## Where to go next

- The [README on GitHub](https://github.com/zitadel/nextgen/tree/main/packages/sdk-next#readme) walks through setting up the middleware, reading the session on the server and in the browser, and the login page.
- Start from {@link middleware!zitadelMiddleware | zitadelMiddleware} and {@link server!auth | auth}, then add {@link components!ZitadelLogin | ZitadelLogin} for the login page.
- Test an app that uses this SDK against a real local Zitadel with [`@zitadel/testing`](https://github.com/zitadel/nextgen/tree/main/packages/testing#readme).
