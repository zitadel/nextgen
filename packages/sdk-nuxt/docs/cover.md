# @zitadel/sdk-nuxt

The Nuxt integration for Zitadel sign-in. It is for developers building a Nuxt 4 app (or later) who want their own pages to sign users in through the `<zitadel-login>` widget, read the signed-in user in components and server routes, and protect routes, without running a separate auth service. Add the module and the app gets a same-origin proxy to the Zitadel backend, session verification on every request and the widgets' custom elements.

This is the API reference. The README on GitHub covers installation and a walkthrough.

## Main components

The package has three entry points.

- `@zitadel/sdk-nuxt/module` holds the Nuxt module. It is the default export, listed under `modules` in `nuxt.config.ts` and configured under the `nextgen` key with {@link index!NextgenMiddlewareOptions}. It installs everything below, so most apps need nothing else.
- `@zitadel/sdk-nuxt/server` holds {@link server!createNextgenMiddleware}, which builds the Nitro middleware by hand for an app that wants to register it itself in `server/middleware`, and {@link server!getAuth}, which reads the verified session from the H3 event in a server route or API handler.
- `@zitadel/sdk-nuxt` holds {@link index!useZitadelProject}, which returns the {@link index!ZitadelProject} handle to pass to a widget's `project` prop, and `businessLocales`, the copy overlay the client plugin provides as `$zitadelBusinessLocales`. Importing this entry also registers the widget elements in the browser.

The module also auto-imports two composables that are not exported from an entry: `useAuth()` returns the client-safe session state (the raw token is left out of the server-rendered payload), and `useZitadelApi()` returns the typed API client for the configured project.

### Module options

The module takes {@link index!NextgenMiddlewareOptions}, the same options `createNextgenMiddleware` takes. Each one is stored in the private `runtimeConfig.nextgen`, so it can be changed on a running server with a `NUXT_NEXTGEN_<NAME>` environment variable without a rebuild.

| Option | Default | Effect |
| --- | --- | --- |
| `url` | `ZITADEL_URL`, then `http://localhost:8080` | The Zitadel backend the proxy forwards to. Never read from the build's environment, so one build serves every environment. |
| `projectId` | `ZITADEL_PROJECT_ID`, then the public project id | The project a session must belong to. A session of another project reads as signed out and its cookie is left alone. |
| `proxyPath` | `/__nextgen` | The prefix reverse-proxied to the backend. Sign-in with an external provider needs the default, because the provider returns to `/__nextgen/idp/{slug}/callback`. |
| `protectedRoutes` | `[]` | Paths that need a session. A trailing `*` matches any sub-path. Visitors without one are redirected to `loginPath`, or get `503` when the backend cannot say whether their session is live. |
| `ignoredRoutes` | `[]` | Paths the middleware skips entirely: no proxy, no verification, no protection. For webhooks and health checks. |
| `loginPath` | `/login` | Where visitors are redirected. Must be a relative path; an absolute or protocol-relative URL is refused to prevent an open redirect. The requested path travels in `next`. |
| `allowedAlgorithms` | `RS256`, `ES256` | JWT `alg` values accepted, checked before the keys are fetched. |
| `allowedTokenTypes` | `JWT`, `at+JWT` | JWT `typ` values accepted. `[]` turns the check off. |
| `audience` | not checked | Expected `aud` claim, a string or a list. |
| `clockSkewMs` | `5000` | Tolerance applied to `exp`, `nbf` and `iat`. |
| `jwksTimeoutMs` | `5000` | How long fetching the signing keys may take before the token is rejected. |
| `proxyTimeoutMs` | `5000` | How long a proxied request may take before it is aborted. |
| `opaqueTokenTimeoutMs` | `5000` | How long the backend may take to answer for an opaque session token. On timeout the cookie is kept and a protected route answers `503`. |
| `jwtKey` | none | Reserved for offline JWT verification; not used yet. |

An option left unset, or set to an empty value, takes its default. The project secret is not an option. The server reads it from `NUXT_NEXTGEN_PROJECT_SECRET` or `ZITADEL_PROJECT_SECRET` when it runs and sends it to the backend only on the session-exchange call, so it never enters the build output or the browser.

## How it works

The wrappers here are not components. The widgets are the `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` custom elements, written in your templates like any HTML element, so nothing builds an element at render time.

On the server, the Nitro middleware runs before your routes. It answers `proxyPath` requests by forwarding them to the backend with the real client address in `X-Forwarded-*`, and for every other request it judges the session cookie (or a `Bearer` token) and stores the result on the event for {@link server!getAuth}. The session cookie travels under the project's own name in the browser, so two apps on one host do not share a session. Because the browser only ever calls the app's own origin, the widgets need no CORS setup and the backend is not exposed to the page.

Server-rendered markup carries the signed-in state, never the token: a plugin seeds `useAuth()` from the event with the raw JWT removed, so it is not serialised into the payload where scripts on the page could read it. The same plugin configures the API client with the proxy path and project id from the public runtime config, which is how the widgets find `/__nextgen` and the project without per-element attributes.

The custom element definitions exist only in the browser. They are loaded by a client-only plugin, because registering elements during SSR would fail, so the server renders the unupgraded tags and the browser upgrades them after hydration. In `nuxt dev` the plugin is also scanned by Vite's dependency optimiser, which pre-bundles the widgets' dependencies at startup instead of file by file on first use.

## Edge runtimes

The entries load without a DOM on Cloudflare Workers and Vercel Edge. The components package resolves to a build with no custom elements when it is bundled for an edge runtime, so importing `@zitadel/sdk-nuxt` there registers nothing and does not throw. The server entry reads the request through H3's accessors rather than Node's `event.node`, and reads the body through the web `Request`, so the proxy, session verification and route protection run in the same way as on Node. The middleware has edge specs that run the built package in Vercel's `edge-runtime` VM.

What renders on the edge is the server side only: the proxy, the session state and redirects. The widgets themselves are never rendered there; they exist in the browser. Runtime config such as the project secret is read from Nitro's runtime config, so set it as a binding that Nitro exposes to the app.

## Where to go next

- The [README on GitHub](https://github.com/zitadel/nextgen/tree/main/packages/sdk-nuxt#readme) for installation and a walkthrough.
- The module: `@zitadel/sdk-nuxt/module`.
- The server helpers {@link server!createNextgenMiddleware} and {@link server!getAuth}.
- The auth types {@link index!AuthResult} and {@link index!ClientAuthResult}, and the options type {@link index!NextgenMiddlewareOptions}.
