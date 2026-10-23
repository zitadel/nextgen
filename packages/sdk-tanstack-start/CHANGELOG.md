# @zitadel/sdk-tanstack-start

## 0.1.0

### Patch Changes

- [#2170](https://github.com/zitadel/nextgen/pull/2170) [`be439bc`](https://github.com/zitadel/nextgen/commit/be439bcf12a9d3a8d7a63194f8f8ae6fe6b26987) Thanks [@mridang](https://github.com/mridang)! - The `@tanstack/react-start` peer range is now `>=1.168.10`, the first release that exports `createCsrfMiddleware`, which the generated `src/start.ts` imports. Earlier releases fail to build with it.
- Updated dependencies [[`114c32c`](https://github.com/zitadel/nextgen/commit/114c32c4a86f7b05794528b889faad159d59bf3f), [`5680eb7`](https://github.com/zitadel/nextgen/commit/5680eb76a273b722456d567f94554e828bcf55e9), [`17523dc`](https://github.com/zitadel/nextgen/commit/17523dcf8e55d9d8a07f27a05c6597749f81ef9b), [`8ef9c49`](https://github.com/zitadel/nextgen/commit/8ef9c495c97188893fd8b879c524ce8e097fa52b), [`dedd93b`](https://github.com/zitadel/nextgen/commit/dedd93ba07e58108771019e70466e858b504c374), [`1653960`](https://github.com/zitadel/nextgen/commit/16539605bbdeadbcf4d8ac2bbfa7e3e16b1af557), [`e3cd8f8`](https://github.com/zitadel/nextgen/commit/e3cd8f81111f3298b5635e31ab3c63a2ce293707), [`be96308`](https://github.com/zitadel/nextgen/commit/be96308eec43f3ffe04a62fd414a18ea2b1ccb21), [`b44d6f9`](https://github.com/zitadel/nextgen/commit/b44d6f9aaf0e7b6c4fdf4579d28b1c69ea0456a1), [`b44d6f9`](https://github.com/zitadel/nextgen/commit/b44d6f9aaf0e7b6c4fdf4579d28b1c69ea0456a1), [`831cb81`](https://github.com/zitadel/nextgen/commit/831cb81978e65f1b5d41b41330c31e9c43fd2030), [`3b206b2`](https://github.com/zitadel/nextgen/commit/3b206b2453cabf4da6840396f2be0e96b4ede8fa)]:
  - @zitadel/api@0.1.0
  - @zitadel/components@0.1.0
  - @zitadel/sdk-core@0.1.0
  - @zitadel/sdk-react@0.1.0

## 1.0.0-alpha.28

### Minor Changes

- [#2071](https://github.com/zitadel/nextgen/pull/2071) [`fa301b9`](https://github.com/zitadel/nextgen/commit/fa301b96daf57512cef6ffb4eb60fdd49cff33e4) Thanks [@fforootd](https://github.com/fforootd)! - The server SDKs now keep each app's session in a cookie named after its
  project, `__nextgen_session_<project id>`, instead of the `__nextgen_session`
  cookie every project on a host shared. On `localhost`, signing in to an app no
  longer signs you out of the Console of `zitadel start` or of another app, and
  signing in to the Console no longer signs you out of your apps.

  The `/__nextgen` proxy renames the cookie Zitadel sets on its way to the
  browser, sends the app's cookie to Zitadel under Zitadel's name, and passes no
  other project's session cookie on. Users who signed in before the upgrade stay
  signed in: the first time the middleware, or the widgets' session check, finds
  that the old cookie holds a session of the app's project, the session is copied
  to the new cookie. The old cookie stays until the user next signs in or out
  through the app, since the Console may share the app's project; then the proxy
  clears it, and on sign-out ends its session too, so it cannot sign the user
  back in. A response that sets a session cookie is never stored by a shared
  cache (`Cache-Control: private, no-store`). With no project configured, the
  proxy passes cookies through unchanged.

  If your server-SDK app reads the session cookie itself, or its tests set it,
  use `sessionCookieName(projectId)` (from `@zitadel/sdk-core`, or from
  `@zitadel/testing` in tests) instead of `__nextgen_session` or
  `SESSION_COOKIE_NAME`: the app's session is no longer kept there.

  `@zitadel/testing` adds `sessionCookieName(projectId)`, the cookie a server-SDK
  app keeps its session in, and `authenticatedPage` now signs its browser context
  in under both names, so it works for SPAs and server-SDK apps alike.
  `SESSION_COOKIE_NAME` stays Zitadel's own name. `@zitadel/sdk-core` adds
  `sessionCookieName`, `proxySessionCookies`, `serializeSessionCookie` and
  `SESSION_COOKIE_CACHE_CONTROL`.

- [#2076](https://github.com/zitadel/nextgen/pull/2076) [`12b3226`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f) Thanks [@fforootd](https://github.com/fforootd)! - The server SDKs now count a session as signed in only when it belongs to the
  app's own project. A session of another project on the same server, such as a
  second app on the same host or the console of a local `zitadel start`, reads
  as signed out in `protectedRoutes`, `auth()` and `getAuth()`, and its cookie is
  left in place for the app it belongs to.

  The project comes from the new `projectId` middleware option, else
  `ZITADEL_PROJECT_ID`, else the framework's public project id variable
  (`NEXT_PUBLIC_`, `VITE_` or `PUBLIC_ZITADEL_PROJECT_ID`). `zitadel setup`
  already writes these to `.env.local`. A deployment that sets none of them must
  set `ZITADEL_PROJECT_ID`, or nobody is signed in. With `@zitadel/sdk-nuxt`, the
  public project id (`NUXT_PUBLIC_ZITADEL_PROJECT_ID`) decides unless
  `nextgen.projectId` names one, so a built server follows it at runtime. A JWT
  session token must name the project in its `aud` claim. `auth()` in
  `@zitadel/sdk-next` also takes the project of `configureZitadel()`; with
  `createProxy(config)`, pass the same project to `auth()` when it lives only in
  that handle.

  `GET /sessions/me` takes an optional `project_id` and answers a session of
  another project with `403 sess.project_mismatch`. The SDKs send it, and so do
  `getSession()` in `@zitadel/sdk-next`, `<zitadel-session>`, `<zitadel-logout>`
  and the console. `getSession()` takes the project from its `projectId` option,
  `configureZitadel()` or `NEXT_PUBLIC_ZITADEL_PROJECT_ID`, and without one reads
  as signed out. Signing out with `<zitadel-logout>` or `<zitadel-session>` no
  longer ends another project's session. The `AGENTS.md` guidance that
  `zitadel setup` writes now tells agents to read the session this way.

  A Bearer token that is not this app's no longer decides what happens to the
  session cookie that came with it: the cookie is judged, and cleared only when
  the backend refuses it, on its own.

  In `@zitadel/api`, `getMySession()` now takes its query parameters first: call
  `getMySession(undefined, init)` where you called `getMySession(init)`. In
  `@zitadel/sdk-core`, `checkOpaqueSessionToken()` and
  `validateOpaqueSessionToken()` take the project id as a fourth argument, and
  `resolveSession()` is the one implementation of these rules behind every server
  SDK's middleware.

  The `@zitadel/sdk-next` middleware also no longer lets a session that has not
  finished signing in through `protectedRoutes`.

- [#2075](https://github.com/zitadel/nextgen/pull/2075) [`f64c9c4`](https://github.com/zitadel/nextgen/commit/f64c9c46b0475e143abd68c2c16e67f134773f08) Thanks [@mridang](https://github.com/mridang)! - The ZitadelLogin, ZitadelLogout and ZitadelSession wrappers of the React, Vue, Svelte, Solid and Qwik SDKs now pass the standard HTML attributes (class, style, id, title, slot, hidden, role, tabindex, data-* and aria-*) to the widget element, so an app can position, style and label a widget without an extra wrapper element, and their props types accept exactly those attributes besides the widget's own props. All five use one definition, standardAttributes in @zitadel/sdk-core/types, which also exports the widgetTags constant that names the three widget elements. This changes behaviour for React and Vue callers: those wrappers used to pass every extra prop or attribute on to the element, and now pass only the standard attributes, so a prop such as an event handler, srcdoc or part no longer reaches the element. In Svelte, removing the title prop leaves title="null" on the element. In Angular the component tag already carries the standard attributes, so that SDK is unchanged. The TanStack Start entry re-exports the new React types.

### Patch Changes

- [#2077](https://github.com/zitadel/nextgen/pull/2077) [`7c3d3dc`](https://github.com/zitadel/nextgen/commit/7c3d3dc557c3be1626c732e61221e33a180e4718) Thanks [@fforootd](https://github.com/fforootd)! - The SvelteKit, SolidStart, Qwik Router and TanStack Start SDKs describe themselves as helpers for Zitadel, in their npm description and README, instead of for "Nextgen Auth".

- [#2097](https://github.com/zitadel/nextgen/pull/2097) [`fce5b01`](https://github.com/zitadel/nextgen/commit/fce5b01506a1941f743c25a51a4011955c7b9bd8) Thanks [@mridang](https://github.com/mridang)! - A `ZITADEL_URL` or `url` option that ends in a slash no longer breaks sign-in. Previously the SDKs requested `//auth/keys` and `//sessions/me` and rejected every token on an issuer mismatch; they now join the backend address and the path properly, and the issuer check stays strict against the address without its trailing slash.

- [#2066](https://github.com/zitadel/nextgen/pull/2066) [`84fe57b`](https://github.com/zitadel/nextgen/commit/84fe57b9b179a144aa2cf21992754c02760b58d6) Thanks [@mridang](https://github.com/mridang)! - The Next.js and TanStack Start proxies no longer take the client address from a request's own `x-real-ip` header, which any caller could set. The address appended to `X-Forwarded-For` now comes only from what the runtime provides, as it already does in the other server SDKs.

- [#2099](https://github.com/zitadel/nextgen/pull/2099) [`20e5433`](https://github.com/zitadel/nextgen/commit/20e5433792cb70a515ad3e22730d8b1ae6dbee74) Thanks [@mridang](https://github.com/mridang)! - The TanStack Start react entry now registers the widgets and re-exports `businessLocales` from `@zitadel/components` itself, like every other client entry, and `@zitadel/sdk-react` no longer needs a type cast to hide element keys from `createComponent`.

- Updated dependencies [[`0f4b901`](https://github.com/zitadel/nextgen/commit/0f4b901f60f2ed20bff71e321564d3b1fc187eab), [`4efca9c`](https://github.com/zitadel/nextgen/commit/4efca9c361ecf7d7806d6147ca3e2e6a31241e23), [`20e5433`](https://github.com/zitadel/nextgen/commit/20e5433792cb70a515ad3e22730d8b1ae6dbee74), [`20e5433`](https://github.com/zitadel/nextgen/commit/20e5433792cb70a515ad3e22730d8b1ae6dbee74), [`437c7f1`](https://github.com/zitadel/nextgen/commit/437c7f127395ac45c8b014948c627516c1f9b4af), [`fce5b01`](https://github.com/zitadel/nextgen/commit/fce5b01506a1941f743c25a51a4011955c7b9bd8), [`fa301b9`](https://github.com/zitadel/nextgen/commit/fa301b96daf57512cef6ffb4eb60fdd49cff33e4), [`628e101`](https://github.com/zitadel/nextgen/commit/628e101e5c254ab8bdaca830fc6e4acbd084b41e), [`12b3226`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f), [`5bf2573`](https://github.com/zitadel/nextgen/commit/5bf257321b290dc54befe3a32b4c39027bd25a2b), [`20e5433`](https://github.com/zitadel/nextgen/commit/20e5433792cb70a515ad3e22730d8b1ae6dbee74), [`f65cebe`](https://github.com/zitadel/nextgen/commit/f65cebe8142daaab33882a8ae22822a75bd94e6f), [`e90dade`](https://github.com/zitadel/nextgen/commit/e90dade940d52ce4827ed63d0171d0de68cf2959), [`f64c9c4`](https://github.com/zitadel/nextgen/commit/f64c9c46b0475e143abd68c2c16e67f134773f08)]:
  - @zitadel/api@1.0.0-alpha.28
  - @zitadel/components@1.0.0-alpha.28
  - @zitadel/sdk-react@1.0.0-alpha.28
  - @zitadel/sdk-core@1.0.0-alpha.28

## 1.0.0-alpha.27

### Patch Changes

- [#2069](https://github.com/zitadel/nextgen/pull/2069) [`eec415d`](https://github.com/zitadel/nextgen/commit/eec415d551befd25e3e057b36274fed31743db20) Thanks [@fforootd](https://github.com/fforootd)! - A Zitadel outage or a slow response no longer signs your users out of your app. The middleware of `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-sveltekit`, `@zitadel/sdk-solid-start`, `@zitadel/sdk-qwik-city` and `@zitadel/sdk-tanstack-start` checks the session cookie against `GET /sessions/me`, and cleared every `__nextgen*` cookie whenever that check failed, a `500`, a timeout or a network error included. It now clears them only when Zitadel refuses the session: a `401`, or a `404` for a session that is gone. When the check gets no answer it can act on, the request renders signed out but keeps its cookie, and a protected route answers `503 Service Unavailable` instead of redirecting a user who may well be signed in to the login page; the next request checks again. `@zitadel/sdk-core/middleware` exports the check as `checkOpaqueSessionToken`, which tells a refused session apart from one Zitadel could not judge.

- [#2055](https://github.com/zitadel/nextgen/pull/2055) [`bdf4347`](https://github.com/zitadel/nextgen/commit/bdf4347950868e3c35d3e6109d48f16dbe17781d) Thanks [@fforootd](https://github.com/fforootd)! - Signing in from a deep link now brings you back with its query string. The middleware of `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-sveltekit`, `@zitadel/sdk-solid-start`, `@zitadel/sdk-qwik-city` and `@zitadel/sdk-tanstack-start` sent a signed-out visit to `/dashboard?tab=billing` to `/login?next=%2Fdashboard`, so the filters and tabs in the link were lost after sign-in. It now keeps the query in `next` (`/login?next=%2Fdashboard%3Ftab%3Dbilling`), and `<zitadel-login>` returns to `/dashboard?tab=billing`. A `next` parameter on the visited URL itself is left out, so one login redirect never nests inside another. `@zitadel/sdk-core/middleware` exports the rule as `loginRedirectUrl(loginPath, requestUrl)` for custom integrations.

- Updated dependencies [[`eec415d`](https://github.com/zitadel/nextgen/commit/eec415d551befd25e3e057b36274fed31743db20), [`bdf4347`](https://github.com/zitadel/nextgen/commit/bdf4347950868e3c35d3e6109d48f16dbe17781d), [`bdf4347`](https://github.com/zitadel/nextgen/commit/bdf4347950868e3c35d3e6109d48f16dbe17781d)]:
  - @zitadel/sdk-core@1.0.0-alpha.27
  - @zitadel/components@1.0.0-alpha.27
  - @zitadel/sdk-react@1.0.0-alpha.27
  - @zitadel/api@1.0.0-alpha.27

## 1.0.0-alpha.26

### Minor Changes

- [#373](https://github.com/zitadel/nextgen/pull/373) [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7) Thanks [@mridang](https://github.com/mridang)! - Add SvelteKit, TanStack Start, SolidStart and Qwik City meta-framework SDKs, mirroring sdk-next and sdk-nuxt. Each ships a server integration that proxies `/__nextgen/*` to the auth backend (attaching the project secret to the `POST /sessions/exchange` handoff only, and forwarding the identity-provider callback's redirect onto the app), verifies the session JWT via JWKS with the Web Crypto API, and redirects unauthenticated requests on protected routes, plus a `getAuth` helper. The SvelteKit, SolidStart and Qwik City SDKs are server-only; their pages render the login, logout and session widgets with the matching framework component SDK (`@zitadel/sdk-svelte`, `@zitadel/sdk-solid`, `@zitadel/sdk-qwik`). The server glue uses each framework's native primitive: a SvelteKit `handle` hook (`createNextgenHandle`), a SolidStart `onRequest` middleware (`createNextgenMiddleware`), a Qwik City `RequestHandler` (`createNextgenOnRequest`), and a TanStack Start request middleware (`createNextgenRequestMiddleware`, with the framework-agnostic `handleNextgenRequest` core exported too). All JWT verification and proxy logic is shared from `@zitadel/sdk-core`.

  Like the Nuxt SDK, these SDKs sign in only a session that names a user. The backend sets the session cookie before a sign-in verifies any factor, so an anonymous session reads as signed out, and its cookie is kept so its sign-in can still complete. The signed-in session carries the user's `identifier`, `identifierProperty` and `display`, and a dead session cookie is cleared on every unauthenticated response. `protectedRoutes` guards full page loads, while the `ZitadelSession` card covers client-side navigation; each README shows how to guard a page on the server before it renders: a `+page.server.ts` load in SvelteKit, a preloaded server query in SolidStart, a `routeLoader$` in Qwik City and a `beforeLoad` server function in TanStack Start.

  `@zitadel/sdk-core/middleware` exports `validateOpaqueSessionToken`, the backend session check these SDKs share, and `requiresProjectSecret`, the rule that only the `POST /sessions/exchange` handoff carries the project secret.

  `@zitadel/sdk-tanstack-start` also ships the widgets, so a TanStack Start app installs no other Zitadel package. Its `/react` entry exports `@zitadel/sdk-react`'s `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` components (every event callback, `children` slots and the signed-in session card), `businessLocales`, and every type `@zitadel/sdk-react` exports, such as `ZitadelFlowCompleteDetail` for typing a callback. Because TanStack Start server-renders every route, the components render nothing on the server and during hydration and mount right after with every prop in place, so a widget never starts a flow with its defaults. The `/client` entry exports `configureZitadel`, `getApi` and `getZitadelConfig`. The README's `src/start.ts` example registers `createCsrfMiddleware` ahead of auth, because adding that file turns off TanStack Start's automatic CSRF protection for server functions.

  sdk-sveltekit peers `@sveltejs/kit` `^2.0.0 || ^3.0.0` and `svelte` `^5.0.0`, the Svelte range `@zitadel/sdk-svelte` supports. sdk-solid-start peers `solid-js` `^1.8.0`, the range `@zitadel/sdk-solid` supports.

  sdk-qwik-city targets Qwik 2: it peers `@qwik.dev/core` and `@qwik.dev/router` (`^2.0.0-beta.45`), like `@zitadel/sdk-qwik`, whose widgets its pages render. A Qwik 1 City app (`@builder.io/qwik-city`) must migrate to `@qwik.dev/*` first. It reads `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET` per request from Qwik City's `ev.env`, which carries `.env.local`, falling back to `process.env`.

  The CLI now detects, scaffolds, and integrates all four meta-frameworks end to end. New detectors recognise SvelteKit (`@sveltejs/kit`), SolidStart (`@solidjs/start`), Qwik City on Qwik 2 (`@qwik.dev/router`) and TanStack Start (`@tanstack/react-start`) and run before their base-SPA detectors so a meta-framework app is no longer mistaken for a bare SPA (the React detector now also excludes TanStack Start). Each gains a scaffolder and a patcher that wires the framework-native server entrypoint (`src/hooks.server.ts`; `src/middleware.ts` registered via the `solidStart()` plugin in `vite.config.ts`; `src/routes/plugin@nextgen.ts`; and a `src/start.ts` request middleware respectively), the landing/login/register/profile routes rendering the widgets from the framework component SDK (from `@zitadel/sdk-tanstack-start/react` for TanStack Start), the public project-id env var, and the matching `@zitadel/sdk-*` dependency. SvelteKit pages read the project id from `VITE_ZITADEL_PROJECT_ID`, which setup seeds in `.env.local`. The generated `/profile` page renders the "signed in as" session card with sign-out, and `setup --use-case business` wires the `businessLocales` work-email copy into the login and register pages. Setup pins the app's `dev` script to the port it registers as the project's origin, with `--strictPort`, and refuses a SolidStart 1 app up front with the reason. `doctor` treats the auth entrypoint, and SolidStart's `vite.config` middleware registration, as managed infrastructure and fails when either is missing.

- [#373](https://github.com/zitadel/nextgen/pull/373) [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7) Thanks [@mridang](https://github.com/mridang)! - Add an Agent Skill for each of the SvelteKit, SolidStart, Qwik City and TanStack Start SDKs, and route to them from the top-level `zitadel` skill. Like the other per-framework skills they are distributed through the repo, not npm, and each teaches the integration pattern while pointing at the installed package's README and types for exact APIs.

### Patch Changes

- [#373](https://github.com/zitadel/nextgen/pull/373) [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7) Thanks [@mridang](https://github.com/mridang)! - Each SDK's root entry now also exports `AuthState` and `UnauthState`, and its `/server` entry exports `AuthResult`, `AuthState`, `UnauthState`, `NextgenSession`, `NextgenMiddlewareOptions` and `ClientAuthResult` beside `getAuth`, so a server route can type what `getAuth` returns without reaching into another entry. This matches `@zitadel/sdk-nuxt` and `@zitadel/sdk-next`.

- [#2040](https://github.com/zitadel/nextgen/pull/2040) [`f156704`](https://github.com/zitadel/nextgen/commit/f156704777bb0970790eade0a1cd0636d5431369) Thanks [@mridang](https://github.com/mridang)! - Refuse any request that carries an `x-nextgen-auth-token` header with a 400 "Bad Request" in all six server SDKs, on every route including ignored routes and the proxy path, instead of removing or overwriting the header. This is a behaviour change for clients: the header is an internal channel that only the SDK sets after verifying a session, so a client that sends it, for example a script that copies headers from a previous response, is now rejected.

- [#2023](https://github.com/zitadel/nextgen/pull/2023) [`c1ec7ca`](https://github.com/zitadel/nextgen/commit/c1ec7cae123e47c5ba5c224625835a3245554314) Thanks [@mridang](https://github.com/mridang)! - The agent skills now share the same sections in every SDK. The Next.js and Nuxt skills call the widget section `Widget props and events` and point to the SDK that documents the props, and the Qwik City, SolidStart, SvelteKit and TanStack Start skills gained that section and say which SDK the widgets come from.

- [#2024](https://github.com/zitadel/nextgen/pull/2024) [`c0c48ce`](https://github.com/zitadel/nextgen/commit/c0c48ce3102fc25d2719eb6d3fa46507757a9e5d) Thanks [@mridang](https://github.com/mridang)! - Every SDK README now has a Requirements section after Installation that lists the peer dependencies the package declares and links the TypeScript floor shared by all SDKs, instead of the Next.js, Nuxt, Qwik City, SolidStart, SvelteKit and TanStack Start READMEs having none and the others restating the reason for the floor.

- Updated dependencies [[`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`17f56de`](https://github.com/zitadel/nextgen/commit/17f56de60ea40128898b6142d93a22c6fc6f2acd), [`717ae39`](https://github.com/zitadel/nextgen/commit/717ae39f47a1f27383e0f4e09d2d32125d5d8f57), [`2f2b873`](https://github.com/zitadel/nextgen/commit/2f2b87360d8604bf0f82271fb27958fbd29170f3), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d), [`66ad8b6`](https://github.com/zitadel/nextgen/commit/66ad8b6a3b2bc42ea8e4678940b686a15a1555ea), [`40470cc`](https://github.com/zitadel/nextgen/commit/40470ccc49759e091c72e103430df0e035dc1f9e), [`decabad`](https://github.com/zitadel/nextgen/commit/decabad10dcd9fb78e5745a62d1e0a9434bd76c0), [`b4886f9`](https://github.com/zitadel/nextgen/commit/b4886f98de362ef6e80cb5e49a38e97daa2288b0), [`290dfe6`](https://github.com/zitadel/nextgen/commit/290dfe6f1c9b45d592e42703573a6acd5b16fa2a), [`4a4132f`](https://github.com/zitadel/nextgen/commit/4a4132fd2dc13f3a833a7aa0ab1dd35ef9b8fd6b), [`a76143e`](https://github.com/zitadel/nextgen/commit/a76143ef82829d098a30de40542f1c9bffb8eb99), [`cba30e6`](https://github.com/zitadel/nextgen/commit/cba30e6df9d61cf399c9d3f7288d21e97c63dd88), [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`3949dab`](https://github.com/zitadel/nextgen/commit/3949daba71747aa6590ef6d454df482329f3322b), [`7fbd942`](https://github.com/zitadel/nextgen/commit/7fbd942580560ccab74d3fdd19b3e1eb6d922ee7), [`bdfca75`](https://github.com/zitadel/nextgen/commit/bdfca75531cd27245da2056b0d048723be012820), [`4a5578b`](https://github.com/zitadel/nextgen/commit/4a5578bf825132c047f37d124d616a3a4f9e9da9), [`44abdb8`](https://github.com/zitadel/nextgen/commit/44abdb8e827ce34d7aae8d620d43904b3142baf9), [`40c35c8`](https://github.com/zitadel/nextgen/commit/40c35c8f49e4e967ff701cf510b6cc6a4e776fc8), [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`ed703ed`](https://github.com/zitadel/nextgen/commit/ed703eddc7791c0cae0844ae30eba29b631db53f), [`02c751f`](https://github.com/zitadel/nextgen/commit/02c751fc59b542e1c9ac6081875a91aa03bc0cbc), [`9564ecf`](https://github.com/zitadel/nextgen/commit/9564ecf403a6e3383c7bf2215708e897aed1f124), [`c0c48ce`](https://github.com/zitadel/nextgen/commit/c0c48ce3102fc25d2719eb6d3fa46507757a9e5d), [`36fbcb4`](https://github.com/zitadel/nextgen/commit/36fbcb4e5383a0d6764efc44e9ac6da4e5c8d596), [`b3b0b28`](https://github.com/zitadel/nextgen/commit/b3b0b2888f0e64a4805f373a9835d8dc853add84), [`c205f49`](https://github.com/zitadel/nextgen/commit/c205f49fa0c6c0ea44407da6776cdb6e5dcfdfc9), [`13042d8`](https://github.com/zitadel/nextgen/commit/13042d8957738091ac428f28c7191f9b2e912697), [`c095aa3`](https://github.com/zitadel/nextgen/commit/c095aa334f77b5b59b6f72baae22703cd7c5369d), [`8182584`](https://github.com/zitadel/nextgen/commit/8182584001fe2115851022e8f92e696db52ee8be), [`3301e90`](https://github.com/zitadel/nextgen/commit/3301e90778a633b6d900a8ca427944f9e0b996d8)]:
  - @zitadel/sdk-core@1.0.0-alpha.26
  - @zitadel/api@1.0.0-alpha.26
  - @zitadel/components@1.0.0-alpha.26
  - @zitadel/sdk-react@1.0.0-alpha.26
