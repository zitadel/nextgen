# @zitadel/sdk-next

## 0.5.0

### Patch Changes

- Updated dependencies [[`cbab822`](https://github.com/zitadel/nextgen/commit/cbab822b77f9c9dc5d53cf985a983df95cabfa99)]:
  - @zitadel/api@0.5.0
  - @zitadel/components@0.5.0
  - @zitadel/sdk-core@0.5.0
  - @zitadel/sdk-react@0.5.0

## 0.4.0

### Minor Changes

- [#2359](https://github.com/zitadel/nextgen/pull/2359) [`eb363f0`](https://github.com/zitadel/nextgen/commit/eb363f04586c594ae893253a6089b21e6e2e390a) - The SDKs, the login components, the console and the `zitadel` CLI now call the API under `/api/v1`, where the server serves it. `@zitadel/api`'s client puts `/api/v1` after the proxy path or server origin it is given, and keeps a single prefix when the origin already ends in it. `zitadel api` takes a path with or without the prefix and shows the full URL with it. A call the server knows no operation for now says the server may be older than the client.
  
  **Breaking:** clients from this release need a server that serves `/api/v1`, so upgrade a self-hosted server before the apps that call it. In a single-page app set up by an earlier `zitadel setup`, run `zitadel doctor --fix`: the dev proxy it wrote adds the project secret only to the old path of the session exchange, so sign-in fails until it is updated, and `zitadel doctor` now fails on it. A production proxy you wrote for a single-page app must add the project secret to `POST /api/v1/sessions/exchange`. Until 1.0.0 the server also answers every operation at its old path, with a `Deprecation` header.

- [#2488](https://github.com/zitadel/nextgen/pull/2488) [`db05fbb`](https://github.com/zitadel/nextgen/commit/db05fbb18b1bf33251694382787be8445da608da) - The session cookie is now `__Host-zitadel_session`, which a browser accepts only from Zitadel's own host over https, so another site under the same domain can no longer plant a session. On `http://localhost` it is `zitadel_session`, so sign-in keeps working in Safari. An app's own, behind a server SDK or dev proxy, adds `_<project id>`.
  
  **Breaking:** every browser signs in again: cookies named `__nextgen_session` are no longer read. Update the server, the server SDKs, the CLI and `@zitadel/testing` together; an SDK from before this release keeps no session with this server, nor the other way round. In `@zitadel/testing`, `SESSION_COOKIE_NAME` is `__Host-zitadel_session`, and `sessionCookieName(projectId, url)` and the new `browserSessionCookieName(url)` name the cookies for the app's URL. `zitadel doctor` fails on the dev proxy of a single-page app set up before this release until `zitadel doctor --fix` updates it.

### Patch Changes

- Updated dependencies [[`0a00b60`](https://github.com/zitadel/nextgen/commit/0a00b60ad40068b39ecb1a4eb9b988f7276d2924), [`79d8dd0`](https://github.com/zitadel/nextgen/commit/79d8dd01660b5bb7a2d936aa330c3d591a8d3954), [`eb363f0`](https://github.com/zitadel/nextgen/commit/eb363f04586c594ae893253a6089b21e6e2e390a), [`26097dd`](https://github.com/zitadel/nextgen/commit/26097dd104c9b6fd6b9e8183921464b54f851a10), [`1ca73bd`](https://github.com/zitadel/nextgen/commit/1ca73bdeb158ad7b9f947e9c0b795cab33d93195), [`eaa07c3`](https://github.com/zitadel/nextgen/commit/eaa07c36f3c76a963214faa8a230f3befa2cff9b), [`665ea7d`](https://github.com/zitadel/nextgen/commit/665ea7db04c57c3abe2b9d60030fcd68f6339e15), [`db05fbb`](https://github.com/zitadel/nextgen/commit/db05fbb18b1bf33251694382787be8445da608da)]:
  - @zitadel/api@0.4.0
  - @zitadel/sdk-core@0.4.0
  - @zitadel/components@0.4.0
  - @zitadel/sdk-react@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [[`ae0f5eb`](https://github.com/zitadel/nextgen/commit/ae0f5ebf8de64dde144b4748307df315b09607f3), [`bc22739`](https://github.com/zitadel/nextgen/commit/bc22739b93d9575f7a278098569df5cecbdf8f15), [`ae0f5eb`](https://github.com/zitadel/nextgen/commit/ae0f5ebf8de64dde144b4748307df315b09607f3)]:
  - @zitadel/api@0.3.0
  - @zitadel/components@0.3.0
  - @zitadel/sdk-core@0.3.0
  - @zitadel/sdk-react@0.3.0

## 0.2.0

### Patch Changes

- [#2374](https://github.com/zitadel/nextgen/pull/2374) [`727b716`](https://github.com/zitadel/nextgen/commit/727b71610839dfd9cc214c73689940f6d29681d6) - The `@zitadel/sdk-next` middleware now asks the Zitadel server about a session only on `protectedRoutes`, and `auth()` asks when a page reads it, so a page that never calls `auth()` costs no call; `resolveSession` in `@zitadel/sdk-core` takes `checkOpaqueSession: false` to leave that check to a render layer.

- [#2372](https://github.com/zitadel/nextgen/pull/2372) [`bbe402b`](https://github.com/zitadel/nextgen/commit/bbe402bd62421f3e7f37dd5e8cfac9760e799b06) - Adding a route to `protectedRoutes` alone now requires a sign-in on it: `zitadel setup` writes a Next.js `proxy.ts` (`middleware.ts` on Next.js 15) whose `matcher` covers every route but Next.js's build files; before, a route missing from the `matcher` stayed public without a warning.
  
  **Upgrading an app set up earlier:** it keeps its `matcher`; replace it with `["/((?!_next/static|_next/image|favicon.ico).*)"]`, or add each protected route to it.

- [#2285](https://github.com/zitadel/nextgen/pull/2285) [`dcea62f`](https://github.com/zitadel/nextgen/commit/dcea62f6cf4858cb55ac4a798ca79659db5075e7) - The `@zitadel/sdk-next` README and the editor docs for `getSession()`, `useAuth()`, `auth()` and `NextgenProvider` now describe the session as `userId`, `identifier`, `identifierProperty` and `display`, the fields they return, and the README places `proxy.ts` next to the `app` directory; the `@zitadel/sdk-nuxt` README names the product Zitadel.

- [#2328](https://github.com/zitadel/nextgen/pull/2328) [`31ef6c1`](https://github.com/zitadel/nextgen/commit/31ef6c1ec87540b0ac5f7b54e6087c67aded32e1) - The packages no longer ship `.d.ts.map` files. They pointed at `src` files the packages do not publish, so an editor's go-to-definition already landed on the `.d.ts`; it still does.
- Updated dependencies [[`2d78353`](https://github.com/zitadel/nextgen/commit/2d78353e4191d576d8d163d312ae78be0e6c4341), [`53386a7`](https://github.com/zitadel/nextgen/commit/53386a7de897e2e0605495246231d42558b27e87), [`fedce7e`](https://github.com/zitadel/nextgen/commit/fedce7e399b15ebe9e1068e072f864f89ffb7bc8), [`db036a5`](https://github.com/zitadel/nextgen/commit/db036a50ad5ae80f7d7d5159ceaeecca4fb5992d), [`dcc1282`](https://github.com/zitadel/nextgen/commit/dcc1282fc30ae06735cdeb627eb013e3ec35df4f), [`c0e9b41`](https://github.com/zitadel/nextgen/commit/c0e9b417cc1814294ef337b1f9e0713553a54bd5), [`d41d1a6`](https://github.com/zitadel/nextgen/commit/d41d1a6a29b50dd77ee48e84d4eba5fe862c7f19), [`727b716`](https://github.com/zitadel/nextgen/commit/727b71610839dfd9cc214c73689940f6d29681d6), [`4bcb7c3`](https://github.com/zitadel/nextgen/commit/4bcb7c3a56d988929099e5c5431f705841963f92), [`2ecde76`](https://github.com/zitadel/nextgen/commit/2ecde76e573c125fd86b7cf7b918619426b624bd), [`89a3471`](https://github.com/zitadel/nextgen/commit/89a34712236d2edc2deb6f482b56a636726956e3), [`33918fa`](https://github.com/zitadel/nextgen/commit/33918faa4ac9300e53d43bf99b55191ba2daa07f), [`5ea7fe4`](https://github.com/zitadel/nextgen/commit/5ea7fe4f9bcaa323c67d2cd347e53e9ba9048d02), [`c21caeb`](https://github.com/zitadel/nextgen/commit/c21caeb5e6c797d092a970129eb2238884d9c9f3), [`704911f`](https://github.com/zitadel/nextgen/commit/704911f26bd82497536579ff07f334da361ecc83), [`5092d59`](https://github.com/zitadel/nextgen/commit/5092d59756c22718e3bd2c1d376a46ae48d958c8), [`31ef6c1`](https://github.com/zitadel/nextgen/commit/31ef6c1ec87540b0ac5f7b54e6087c67aded32e1)]:
  - @zitadel/api@0.2.0
  - @zitadel/components@0.2.0
  - @zitadel/sdk-core@0.2.0
  - @zitadel/sdk-react@0.2.0

## 0.1.0

### Patch Changes

- [#2177](https://github.com/zitadel/nextgen/pull/2177) [`9194819`](https://github.com/zitadel/nextgen/commit/919481901283c4dddc6ce32276439b47b53961e8) Thanks [@mridang](https://github.com/mridang)! - Add `@zitadel/sdk-next/components`, a `"use client"` entry that re-exports the React `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` wrappers, so `project` and `locales` reach the element as properties after server-rendered hydration on React 19 and on React 18, where the raw elements lose them or write `[object Object]` attributes. The Next.js pages `zitadel setup` scaffolds now render the wrappers.
- Updated dependencies [[`114c32c`](https://github.com/zitadel/nextgen/commit/114c32c4a86f7b05794528b889faad159d59bf3f), [`5680eb7`](https://github.com/zitadel/nextgen/commit/5680eb76a273b722456d567f94554e828bcf55e9), [`17523dc`](https://github.com/zitadel/nextgen/commit/17523dcf8e55d9d8a07f27a05c6597749f81ef9b), [`8ef9c49`](https://github.com/zitadel/nextgen/commit/8ef9c495c97188893fd8b879c524ce8e097fa52b), [`dedd93b`](https://github.com/zitadel/nextgen/commit/dedd93ba07e58108771019e70466e858b504c374), [`1653960`](https://github.com/zitadel/nextgen/commit/16539605bbdeadbcf4d8ac2bbfa7e3e16b1af557), [`e3cd8f8`](https://github.com/zitadel/nextgen/commit/e3cd8f81111f3298b5635e31ab3c63a2ce293707), [`be96308`](https://github.com/zitadel/nextgen/commit/be96308eec43f3ffe04a62fd414a18ea2b1ccb21), [`b44d6f9`](https://github.com/zitadel/nextgen/commit/b44d6f9aaf0e7b6c4fdf4579d28b1c69ea0456a1), [`b44d6f9`](https://github.com/zitadel/nextgen/commit/b44d6f9aaf0e7b6c4fdf4579d28b1c69ea0456a1), [`831cb81`](https://github.com/zitadel/nextgen/commit/831cb81978e65f1b5d41b41330c31e9c43fd2030), [`3b206b2`](https://github.com/zitadel/nextgen/commit/3b206b2453cabf4da6840396f2be0e96b4ede8fa)]:
  - @zitadel/api@0.1.0
  - @zitadel/components@0.1.0
  - @zitadel/sdk-core@0.1.0
  - @zitadel/sdk-react@0.1.0

## 1.0.0-alpha.28

### Minor Changes

- [#2099](https://github.com/zitadel/nextgen/pull/2099) [`20e5433`](https://github.com/zitadel/nextgen/commit/20e5433792cb70a515ad3e22730d8b1ae6dbee74) Thanks [@mridang](https://github.com/mridang)! - `@zitadel/sdk-react`, `@zitadel/sdk-next/client` and `@zitadel/sdk-nuxt` now load on edge runtimes. The React wrapper no longer imports the element classes from `@zitadel/components`: it renders each widget by its tag name, registers the elements in the browser with a side-effect import, and looks the class up in the custom element registry when it renders, so the props, events, refs and server markup are unchanged. Every client SDK entry now carries the same two lines for the components, the registering import and the `businessLocales` re-export, and none exports an element class.

  **Breaking:** `@zitadel/sdk-next/client` and `@zitadel/sdk-nuxt` no longer export `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession`, which no other SDK exports either, because a value export of a class cannot load without a DOM. Import the classes from `@zitadel/components` in browser-only code if you need them. To type a ref to a widget element, use `HTMLElementTagNameMap["zitadel-login"]`.

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

### Patch Changes

- [#2145](https://github.com/zitadel/nextgen/pull/2145) [`4d63c44`](https://github.com/zitadel/nextgen/commit/4d63c44b4f60dd02382d28fbc2fcf5fd1046f065) Thanks [@fforootd](https://github.com/fforootd)! - A Next.js app created by `zitadel setup --framework next` no longer logs ``Could not validate `instant` `` errors in `next dev` on every request to `/`. The home page setup writes still redirects to `/login`, and now opts out of Next.js's instant-navigation check, which Cache Components (on by default in new Next.js apps) runs on every page. The `@zitadel/sdk-next` README's `auth()` examples now render the component that calls `auth()` inside `<Suspense>` and import it from `@zitadel/sdk-next/server`, so they build with Cache Components on.

- [#2097](https://github.com/zitadel/nextgen/pull/2097) [`fce5b01`](https://github.com/zitadel/nextgen/commit/fce5b01506a1941f743c25a51a4011955c7b9bd8) Thanks [@mridang](https://github.com/mridang)! - A `ZITADEL_URL` or `url` option that ends in a slash no longer breaks sign-in. Previously the SDKs requested `//auth/keys` and `//sessions/me` and rejected every token on an issuer mismatch; they now join the backend address and the path properly, and the issuer check stays strict against the address without its trailing slash.

- [#2066](https://github.com/zitadel/nextgen/pull/2066) [`84fe57b`](https://github.com/zitadel/nextgen/commit/84fe57b9b179a144aa2cf21992754c02760b58d6) Thanks [@mridang](https://github.com/mridang)! - The Next.js and TanStack Start proxies no longer take the client address from a request's own `x-real-ip` header, which any caller could set. The address appended to `X-Forwarded-For` now comes only from what the runtime provides, as it already does in the other server SDKs.

- Updated dependencies [[`0f4b901`](https://github.com/zitadel/nextgen/commit/0f4b901f60f2ed20bff71e321564d3b1fc187eab), [`4efca9c`](https://github.com/zitadel/nextgen/commit/4efca9c361ecf7d7806d6147ca3e2e6a31241e23), [`20e5433`](https://github.com/zitadel/nextgen/commit/20e5433792cb70a515ad3e22730d8b1ae6dbee74), [`437c7f1`](https://github.com/zitadel/nextgen/commit/437c7f127395ac45c8b014948c627516c1f9b4af), [`fce5b01`](https://github.com/zitadel/nextgen/commit/fce5b01506a1941f743c25a51a4011955c7b9bd8), [`fa301b9`](https://github.com/zitadel/nextgen/commit/fa301b96daf57512cef6ffb4eb60fdd49cff33e4), [`628e101`](https://github.com/zitadel/nextgen/commit/628e101e5c254ab8bdaca830fc6e4acbd084b41e), [`12b3226`](https://github.com/zitadel/nextgen/commit/12b3226ca941e51534d834c23eea01a872153d9f), [`5bf2573`](https://github.com/zitadel/nextgen/commit/5bf257321b290dc54befe3a32b4c39027bd25a2b), [`f65cebe`](https://github.com/zitadel/nextgen/commit/f65cebe8142daaab33882a8ae22822a75bd94e6f), [`e90dade`](https://github.com/zitadel/nextgen/commit/e90dade940d52ce4827ed63d0171d0de68cf2959), [`f64c9c4`](https://github.com/zitadel/nextgen/commit/f64c9c46b0475e143abd68c2c16e67f134773f08)]:
  - @zitadel/api@1.0.0-alpha.28
  - @zitadel/components@1.0.0-alpha.28
  - @zitadel/sdk-core@1.0.0-alpha.28

## 1.0.0-alpha.27

### Patch Changes

- [#2069](https://github.com/zitadel/nextgen/pull/2069) [`eec415d`](https://github.com/zitadel/nextgen/commit/eec415d551befd25e3e057b36274fed31743db20) Thanks [@fforootd](https://github.com/fforootd)! - A Zitadel outage or a slow response no longer signs your users out of your app. The middleware of `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-sveltekit`, `@zitadel/sdk-solid-start`, `@zitadel/sdk-qwik-city` and `@zitadel/sdk-tanstack-start` checks the session cookie against `GET /sessions/me`, and cleared every `__nextgen*` cookie whenever that check failed, a `500`, a timeout or a network error included. It now clears them only when Zitadel refuses the session: a `401`, or a `404` for a session that is gone. When the check gets no answer it can act on, the request renders signed out but keeps its cookie, and a protected route answers `503 Service Unavailable` instead of redirecting a user who may well be signed in to the login page; the next request checks again. `@zitadel/sdk-core/middleware` exports the check as `checkOpaqueSessionToken`, which tells a refused session apart from one Zitadel could not judge.

- [#2055](https://github.com/zitadel/nextgen/pull/2055) [`bdf4347`](https://github.com/zitadel/nextgen/commit/bdf4347950868e3c35d3e6109d48f16dbe17781d) Thanks [@fforootd](https://github.com/fforootd)! - Signing in from a deep link now brings you back with its query string. The middleware of `@zitadel/sdk-next`, `@zitadel/sdk-nuxt`, `@zitadel/sdk-sveltekit`, `@zitadel/sdk-solid-start`, `@zitadel/sdk-qwik-city` and `@zitadel/sdk-tanstack-start` sent a signed-out visit to `/dashboard?tab=billing` to `/login?next=%2Fdashboard`, so the filters and tabs in the link were lost after sign-in. It now keeps the query in `next` (`/login?next=%2Fdashboard%3Ftab%3Dbilling`), and `<zitadel-login>` returns to `/dashboard?tab=billing`. A `next` parameter on the visited URL itself is left out, so one login redirect never nests inside another. `@zitadel/sdk-core/middleware` exports the rule as `loginRedirectUrl(loginPath, requestUrl)` for custom integrations.

- Updated dependencies [[`eec415d`](https://github.com/zitadel/nextgen/commit/eec415d551befd25e3e057b36274fed31743db20), [`bdf4347`](https://github.com/zitadel/nextgen/commit/bdf4347950868e3c35d3e6109d48f16dbe17781d), [`bdf4347`](https://github.com/zitadel/nextgen/commit/bdf4347950868e3c35d3e6109d48f16dbe17781d)]:
  - @zitadel/sdk-core@1.0.0-alpha.27
  - @zitadel/components@1.0.0-alpha.27
  - @zitadel/api@1.0.0-alpha.27

## 1.0.0-alpha.26

### Minor Changes

- [#1630](https://github.com/zitadel/nextgen/pull/1630) [`3949dab`](https://github.com/zitadel/nextgen/commit/3949daba71747aa6590ef6d454df482329f3322b) Thanks [@peintnermax](https://github.com/peintnermax)! - feat: password fields in `<zitadel-login>` now have a show/hide button, as
  NIST SP 800-63B recommends. It is on by default; set `suppress-password-toggle`
  on the element (a `suppressPasswordToggle` prop on every framework wrapper) to
  hide it. The setting belongs to the embedding page and is not stored with the
  branding.

  The button replaces the clear button on password fields, so the field shows
  one icon. It sits in the tab order right after the input, so keyboard users
  can reach it, while a pointer click keeps focus in the field. A revealed
  field opts out of spellcheck and autocorrect, and it is hidden again on
  submit, form reset and step change. The widget applies the setting to its
  fields directly, so it also holds for ejected templates; it is not a
  `<zl-field>` attribute.

  `@zitadel/testing`: the flow helpers' label fallback (`flowField` with a
  `label`, used by `loginWithPassword` and `registerWithPassword`) now matches
  the field by its textbox role, so the toggle's "Show password" name never
  competes with the password field.

### Patch Changes

- [#1977](https://github.com/zitadel/nextgen/pull/1977) [`2f2b873`](https://github.com/zitadel/nextgen/commit/2f2b87360d8604bf0f82271fb27958fbd29170f3) Thanks [@mridang](https://github.com/mridang)! - The SPA SDK READMEs now have an Installation section with the `@alpha` dist-tag and name their peer dependencies, and the Agent Skills use one install-note wording and the same `npx @zitadel/cli@alpha setup` command for scaffolding a new app.

- [#1922](https://github.com/zitadel/nextgen/pull/1922) [`2e26a4c`](https://github.com/zitadel/nextgen/commit/2e26a4ccf50793fa1fd226d91bc32cb03a3ac626) Thanks [@mridang](https://github.com/mridang)! - `@zitadel/sdk-next` now requires Next.js 15.2.3 or later; the `next` peer range moves from `>=15` to
  `>=15.2.3`. Next.js 15.0.0 to 15.2.2 skip middleware for a request that sends an
  `x-middleware-subrequest` header (CVE-2025-29927), so on self-hosted deployments (`next start`) anyone
  could reach a route that relies on `protectedRoutes` alone. Apps locked to 15.0.x through 15.2.2 will see
  an unmet peer dependency warning, or an install error under npm, until they upgrade Next.js.

- [#1995](https://github.com/zitadel/nextgen/pull/1995) [`decabad`](https://github.com/zitadel/nextgen/commit/decabad10dcd9fb78e5745a62d1e0a9434bd76c0) Thanks [@mridang](https://github.com/mridang)! - The READMEs and agent skills of every SDK now list the same widget props (including `heading`, `logoutLabel` and `suppressPasswordToggle`) and all six widget events, and the Next.js and Nuxt SDKs list the events their widgets dispatch.

- [#1958](https://github.com/zitadel/nextgen/pull/1958) [`3d874fe`](https://github.com/zitadel/nextgen/commit/3d874fed0cf840fbc8caf6aec1167c200f58ff7c) Thanks [@mridang](https://github.com/mridang)! - `@zitadel/sdk-next/server` now exports `AuthResult`, `AuthState`, `UnauthState`, `NextgenSession`, `ClientAuthResult` and `NextgenMiddlewareOptions` beside `auth`, so a Server Component can type what `auth()` returns without reaching into another entry.

- [#1633](https://github.com/zitadel/nextgen/pull/1633) [`290dfe6`](https://github.com/zitadel/nextgen/commit/290dfe6f1c9b45d592e42703573a6acd5b16fa2a) Thanks [@wim07101993](https://github.com/wim07101993)! - Each sign-in provider connection now has its own callback route, `GET /__nextgen/idp/{slug}/callback`, also served as `/idp/{slug}/callback` for a scaffolded app's SDK proxy. The authorize request and the token exchange send it as `redirect_uri`. The shared `/__nextgen/idp/callback` route is removed. This is a breaking change: if you registered it at a provider, register the connection's own URI instead, for example `http://localhost:3000/__nextgen/idp/google/callback`, or sign-in with that provider fails. `zitadel sso enable --provider <slug>` prints it. The route defends against the IdP mix-up attack (RFC 9700 §4.4): a callback whose path names another connection than the one the sign-in started with is refused before any code exchange, the step the sign-in started from shows `error.sso_failed`, and the events stream records `auth.sso.exchange.failed`, or `auth.sso.authorization.failed` when no code arrived. When the provider sends the RFC 9207 `iss` parameter, the callback also refuses a value that is not the connection's issuer, the same way. A response without `iss` is not refused, even from a provider that advertises it. The SDK `proxyPath` docs name the new route.

- [#1900](https://github.com/zitadel/nextgen/pull/1900) [`a76143e`](https://github.com/zitadel/nextgen/commit/a76143ef82829d098a30de40542f1c9bffb8eb99) Thanks [@mridang](https://github.com/mridang)! - JWT verification now caches each issuer's whole JWKS document instead of one key per `kid`. A token naming a `kid` the cached keys lack refreshes them — how a rotated key is picked up — at most once every 30 seconds, and concurrent misses share one fetch; previously any token with a made-up `kid` cost a JWKS request, an unauthenticated way to load the backend on every request. An EC key that names no `alg` now verifies (its curve decides the algorithm), and a token whose `alg` cannot fit the key is rejected quietly instead of logging an error. `clearJwksCache()` drops the cached keys, for example after a key compromise. An expired key set is never used when its refresh fails, a failed fetch counts toward the 30 second throttle so a failing endpoint is not retried on every request, and `clearJwksCache()` also discards fetches that were already in flight.

- [#1919](https://github.com/zitadel/nextgen/pull/1919) [`4d4b4b3`](https://github.com/zitadel/nextgen/commit/4d4b4b39216828ac1d77a75f97bd6149e55b5a67) Thanks [@mridang](https://github.com/mridang)! - The README and Agent Skill install commands now name the `@alpha` dist-tag (`pnpm add @zitadel/sdk-next@alpha`). Without it, npm installs an old preview from `latest` instead of the current release.

- [#1901](https://github.com/zitadel/nextgen/pull/1901) [`4a5578b`](https://github.com/zitadel/nextgen/commit/4a5578bf825132c047f37d124d616a3a4f9e9da9) Thanks [@mridang](https://github.com/mridang)! - `protectedRoutes` and `ignoredRoutes` entries now match with or without a trailing slash, so `/profile/` can no longer bypass `protectedRoutes: ["/profile"]`.

- [#2040](https://github.com/zitadel/nextgen/pull/2040) [`f156704`](https://github.com/zitadel/nextgen/commit/f156704777bb0970790eade0a1cd0636d5431369) Thanks [@mridang](https://github.com/mridang)! - Refuse any request that carries an `x-nextgen-auth-token` header with a 400 "Bad Request" in all six server SDKs, on every route including ignored routes and the proxy path, instead of removing or overwriting the header. This is a behaviour change for clients: the header is an internal channel that only the SDK sets after verifying a session, so a client that sends it, for example a script that copies headers from a previous response, is now rejected.

- [#2023](https://github.com/zitadel/nextgen/pull/2023) [`c1ec7ca`](https://github.com/zitadel/nextgen/commit/c1ec7cae123e47c5ba5c224625835a3245554314) Thanks [@mridang](https://github.com/mridang)! - The agent skills now share the same sections in every SDK. The Next.js and Nuxt skills call the widget section `Widget props and events` and point to the SDK that documents the props, and the Qwik City, SolidStart, SvelteKit and TanStack Start skills gained that section and say which SDK the widgets come from.

- [#2024](https://github.com/zitadel/nextgen/pull/2024) [`c0c48ce`](https://github.com/zitadel/nextgen/commit/c0c48ce3102fc25d2719eb6d3fa46507757a9e5d) Thanks [@mridang](https://github.com/mridang)! - Every SDK README now has a Requirements section after Installation that lists the peer dependencies the package declares and links the TypeScript floor shared by all SDKs, instead of the Next.js, Nuxt, Qwik City, SolidStart, SvelteKit and TanStack Start READMEs having none and the others restating the reason for the floor.

- Updated dependencies [[`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`17f56de`](https://github.com/zitadel/nextgen/commit/17f56de60ea40128898b6142d93a22c6fc6f2acd), [`717ae39`](https://github.com/zitadel/nextgen/commit/717ae39f47a1f27383e0f4e09d2d32125d5d8f57), [`c3e8fa4`](https://github.com/zitadel/nextgen/commit/c3e8fa47306d9f286d07303fea977e3f6d910d7d), [`66ad8b6`](https://github.com/zitadel/nextgen/commit/66ad8b6a3b2bc42ea8e4678940b686a15a1555ea), [`40470cc`](https://github.com/zitadel/nextgen/commit/40470ccc49759e091c72e103430df0e035dc1f9e), [`b4886f9`](https://github.com/zitadel/nextgen/commit/b4886f98de362ef6e80cb5e49a38e97daa2288b0), [`290dfe6`](https://github.com/zitadel/nextgen/commit/290dfe6f1c9b45d592e42703573a6acd5b16fa2a), [`4a4132f`](https://github.com/zitadel/nextgen/commit/4a4132fd2dc13f3a833a7aa0ab1dd35ef9b8fd6b), [`a76143e`](https://github.com/zitadel/nextgen/commit/a76143ef82829d098a30de40542f1c9bffb8eb99), [`cba30e6`](https://github.com/zitadel/nextgen/commit/cba30e6df9d61cf399c9d3f7288d21e97c63dd88), [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`3949dab`](https://github.com/zitadel/nextgen/commit/3949daba71747aa6590ef6d454df482329f3322b), [`7fbd942`](https://github.com/zitadel/nextgen/commit/7fbd942580560ccab74d3fdd19b3e1eb6d922ee7), [`bdfca75`](https://github.com/zitadel/nextgen/commit/bdfca75531cd27245da2056b0d048723be012820), [`4a5578b`](https://github.com/zitadel/nextgen/commit/4a5578bf825132c047f37d124d616a3a4f9e9da9), [`44abdb8`](https://github.com/zitadel/nextgen/commit/44abdb8e827ce34d7aae8d620d43904b3142baf9), [`40c35c8`](https://github.com/zitadel/nextgen/commit/40c35c8f49e4e967ff701cf510b6cc6a4e776fc8), [`7f82bfc`](https://github.com/zitadel/nextgen/commit/7f82bfc46930d2b8ca4132e569dfa4db4abfd5c7), [`02c751f`](https://github.com/zitadel/nextgen/commit/02c751fc59b542e1c9ac6081875a91aa03bc0cbc), [`9564ecf`](https://github.com/zitadel/nextgen/commit/9564ecf403a6e3383c7bf2215708e897aed1f124), [`36fbcb4`](https://github.com/zitadel/nextgen/commit/36fbcb4e5383a0d6764efc44e9ac6da4e5c8d596), [`b3b0b28`](https://github.com/zitadel/nextgen/commit/b3b0b2888f0e64a4805f373a9835d8dc853add84), [`c205f49`](https://github.com/zitadel/nextgen/commit/c205f49fa0c6c0ea44407da6776cdb6e5dcfdfc9), [`13042d8`](https://github.com/zitadel/nextgen/commit/13042d8957738091ac428f28c7191f9b2e912697), [`c095aa3`](https://github.com/zitadel/nextgen/commit/c095aa334f77b5b59b6f72baae22703cd7c5369d), [`8182584`](https://github.com/zitadel/nextgen/commit/8182584001fe2115851022e8f92e696db52ee8be), [`3301e90`](https://github.com/zitadel/nextgen/commit/3301e90778a633b6d900a8ca427944f9e0b996d8)]:
  - @zitadel/sdk-core@1.0.0-alpha.26
  - @zitadel/api@1.0.0-alpha.26
  - @zitadel/components@1.0.0-alpha.26

## 1.0.0-alpha.25

### Minor Changes

- [#1406](https://github.com/zitadel/nextgen/pull/1406) [`46a366f`](https://github.com/zitadel/nextgen/commit/46a366fabf688964b3a62158e6922902f0f0045b) Thanks [@mridang](https://github.com/mridang)! - Add a per-framework Agent Skill for each SDK and `@zitadel/components`, alongside a top-level `zitadel` router skill that routes to the right one. The skills are distributed through the repo (not published to npm); a single `npx skills add zitadel/nextgen --full-depth` installs the whole set, giving a coding agent framework-specific guidance for integrating Zitadel auth into a React, Next.js, Angular, Nuxt, Vue, Solid, Svelte, or Qwik app — including existing apps the CLI can't scaffold — and for embedding the `<zitadel-login>` web component directly. Each skill is discover-first: it teaches the integration pattern and points at the installed package's own README and types for exact APIs, so it does not drift with the package version.

### Patch Changes

- [#1478](https://github.com/zitadel/nextgen/pull/1478) [`9b7b4b2`](https://github.com/zitadel/nextgen/commit/9b7b4b2268b968b03752393850c28d047eca13cc) Thanks [@grvijayan](https://github.com/grvijayan)! - The `proxyPath` docs state that sign-in with an external provider currently requires the default `/__nextgen`: the provider returns to `/__nextgen/idp/callback`, which a custom prefix does not forward.

- Updated dependencies [[`3937a77`](https://github.com/zitadel/nextgen/commit/3937a7724380c0e59ff039e946053945a8e6475d), [`0ca8019`](https://github.com/zitadel/nextgen/commit/0ca80197fedb2755964617d9fe5f17e08b1cb95b), [`d821e91`](https://github.com/zitadel/nextgen/commit/d821e91a4f778b29a524c8a67129951795a16f8d), [`4af9f8e`](https://github.com/zitadel/nextgen/commit/4af9f8ec460b3f83f11bece0d4134f0fa1d2e52e), [`79527ed`](https://github.com/zitadel/nextgen/commit/79527edba346d39fd43502eb4357d3d19a77ad2d), [`6aca9bb`](https://github.com/zitadel/nextgen/commit/6aca9bb9afcb6e2b33f9e5e5cf5af6c1319d4fe1), [`6821cc6`](https://github.com/zitadel/nextgen/commit/6821cc62356ef75cce936907d203470f35cd1a9a), [`c03400d`](https://github.com/zitadel/nextgen/commit/c03400d0a6263534a1fe862eacf198d62979230d), [`77369ca`](https://github.com/zitadel/nextgen/commit/77369ca215600478d8f56740406ce9f52cf09d00), [`7897a77`](https://github.com/zitadel/nextgen/commit/7897a77cd7963591827bf1427574f0bb0b2df827), [`46a366f`](https://github.com/zitadel/nextgen/commit/46a366fabf688964b3a62158e6922902f0f0045b), [`faccf02`](https://github.com/zitadel/nextgen/commit/faccf02136ff713718e103b18d4128e5a665d02e), [`0ca8019`](https://github.com/zitadel/nextgen/commit/0ca80197fedb2755964617d9fe5f17e08b1cb95b), [`790ce8e`](https://github.com/zitadel/nextgen/commit/790ce8eb90ba043574f5822216e88de89b5767c9), [`59c6e9a`](https://github.com/zitadel/nextgen/commit/59c6e9ab1f6a77c327be53bd7ffe89073f2192f2), [`b208b0c`](https://github.com/zitadel/nextgen/commit/b208b0c7635b7c146c0fa7294ead08c92eba6cd2), [`9b7b4b2`](https://github.com/zitadel/nextgen/commit/9b7b4b2268b968b03752393850c28d047eca13cc), [`0269f56`](https://github.com/zitadel/nextgen/commit/0269f56e8299584b20e5815cf9b8d3c84ae65010), [`0269f56`](https://github.com/zitadel/nextgen/commit/0269f56e8299584b20e5815cf9b8d3c84ae65010), [`9b7b4b2`](https://github.com/zitadel/nextgen/commit/9b7b4b2268b968b03752393850c28d047eca13cc)]:
  - @zitadel/api@1.0.0-alpha.25
  - @zitadel/components@1.0.0-alpha.25
  - @zitadel/sdk-core@1.0.0-alpha.25

## 1.0.0-alpha.24

### Patch Changes

- [#1323](https://github.com/zitadel/nextgen/pull/1323) [`d7615bc`](https://github.com/zitadel/nextgen/commit/d7615bcd1253b7163333f84c9b51f5923eb684b7) Thanks [@mridang](https://github.com/mridang)! - Signing in with an external identity provider now returns to your app instead of leaving the browser on a blank page. `@zitadel/sdk-next` and `@zitadel/sdk-nuxt` discarded the redirect the provider's callback answers with, so a successful sign-in never reached the page that started it.

- Updated dependencies [[`91b1eb6`](https://github.com/zitadel/nextgen/commit/91b1eb653fc00633cf64e9d93c9edf73e3687933), [`4bea70a`](https://github.com/zitadel/nextgen/commit/4bea70a7244b44e62476e6dd2dc6b8e4a7bd1a45), [`e61c854`](https://github.com/zitadel/nextgen/commit/e61c8545f06ce9ebe25e7f2e0d344cb6f8efb0d0), [`f2e81dd`](https://github.com/zitadel/nextgen/commit/f2e81dd84af7e47c06c084365dea983ee59a305b), [`8853408`](https://github.com/zitadel/nextgen/commit/88534088991a21027f7e7dd6bea1ff76fe43edf0), [`d7615bc`](https://github.com/zitadel/nextgen/commit/d7615bcd1253b7163333f84c9b51f5923eb684b7)]:
  - @zitadel/api@1.0.0-alpha.24
  - @zitadel/components@1.0.0-alpha.24
  - @zitadel/sdk-core@1.0.0-alpha.24

## 1.0.0-alpha.23

### Patch Changes

- Updated dependencies [[`3a10eb6`](https://github.com/zitadel/nextgen/commit/3a10eb61dd7e597ccd5b62d8a39453fb7645673e), [`f8c5a24`](https://github.com/zitadel/nextgen/commit/f8c5a24aa87015e722f2f6ecfb276b839d46f4de), [`93cac33`](https://github.com/zitadel/nextgen/commit/93cac336402cae09a3e6dfb8622556d13794ab71), [`93cac33`](https://github.com/zitadel/nextgen/commit/93cac336402cae09a3e6dfb8622556d13794ab71), [`fc1bb82`](https://github.com/zitadel/nextgen/commit/fc1bb8299cd1dddde0b5490d74385576b83e4ad4), [`1162dc9`](https://github.com/zitadel/nextgen/commit/1162dc91c274fcd96bf3dada5b474356242cc1b9), [`85db700`](https://github.com/zitadel/nextgen/commit/85db70036625cdf6dc4560487c4f7cf6f6694a1d), [`583a8ed`](https://github.com/zitadel/nextgen/commit/583a8ed0c6142539539eb6e082de8dbfe11a3246), [`6c3f4a3`](https://github.com/zitadel/nextgen/commit/6c3f4a35e6466e9335ebb00b9943902faef8f2f8), [`205cef5`](https://github.com/zitadel/nextgen/commit/205cef525ee26250b652ee40f0b35622dc05caea), [`85fb5ab`](https://github.com/zitadel/nextgen/commit/85fb5abc1edd8699b86898e57d31c4938a6228a5), [`58c25fd`](https://github.com/zitadel/nextgen/commit/58c25fd9dd9776ab3d92a86515c879d6f4888de4), [`8fc4472`](https://github.com/zitadel/nextgen/commit/8fc44720d0b93f6d5450bff85cb8ed984712156a), [`b70e520`](https://github.com/zitadel/nextgen/commit/b70e52035b433e7c3293c54be43352bb59e78dc2), [`ce3c67c`](https://github.com/zitadel/nextgen/commit/ce3c67c10b7ef7f20a30335fedb07325b6146cad)]:
  - @zitadel/api@1.0.0-alpha.23
  - @zitadel/components@1.0.0-alpha.23
  - @zitadel/sdk-core@1.0.0-alpha.23

## 1.0.0-alpha.22

### Patch Changes

- Updated dependencies [[`82186ce`](https://github.com/zitadel/nextgen/commit/82186ce7da8dd96cd0f178a3a7c9994d7ee00cea), [`af21963`](https://github.com/zitadel/nextgen/commit/af21963a99d6f827699249fa524fbc64f2e6baab)]:
  - @zitadel/api@1.0.0-alpha.22
  - @zitadel/components@1.0.0-alpha.22
  - @zitadel/sdk-core@1.0.0-alpha.22

## 1.0.0-alpha.21

### Minor Changes

- [#1085](https://github.com/zitadel/nextgen/pull/1085) [`a59b288`](https://github.com/zitadel/nextgen/commit/a59b288e4e52a3274c1ab4b5e4c241f1083aac6b) Thanks [@livio-a](https://github.com/livio-a)! - Session responses identify their user through a resolved **user ref** derived
  from the user schema's own `x-identifier`/`x-display` designations (ADR 058),
  replacing the convention-resolved flat `name`/`email` fields this supersedes
  (see the earlier `GET /sessions/me` identity changeset). Rendering follows one
  chain everywhere: `display`, falling back to `identifier`, then `user_id`.
  - `@zitadel/server`: `GET /sessions/me`, session get, and query sessions embed
    `user` (`{user_id, identifier, identifier_property, display}`), the list
    path hydrated with one batch resolution per page — listed sessions now carry
    user identity at all. The conventional attribute-name resolver
    (`name`/`givenName`+`familyName`/`email`) is removed.
  - `@zitadel/api`: the regenerated client types the new `user` ref component.
  - `@zitadel/components`: `<zitadel-session>`/`<zitadel-logout>` render from
    the ref; the `zitadel-signout` detail is now `{display, identifier}`;
    logout templates substitute `{{display}}`/`{{identifier}}` (the old
    `{{name}}`/`{{email}}` tokens keep filling as aliases).
  - `@zitadel/sdk-core` (and every SPA SDK via the shared contract):
    `NextgenSession`/`ClientSession` become `{userId, identifier,
identifierProperty, display}`; JWT-claim identities map `name` → `display`
    and `email` → `identifier`.
  - `@zitadel/sdk-next` / `@zitadel/sdk-nuxt`: server and client session reads
    return the new shape.
  - `@zitadel/cli`: scaffolded Nuxt auth plugins emit the new fields.

  **Breaking:** the flat `name`/`email` session fields and the old SDK session
  shape are gone. An unknown property is dropped rather than rejected, so a
  client left on the old fields reads silently empty values instead of failing
  loudly — update server, SDKs, and app chrome together.

### Patch Changes

- Updated dependencies [[`a59b288`](https://github.com/zitadel/nextgen/commit/a59b288e4e52a3274c1ab4b5e4c241f1083aac6b), [`7a06425`](https://github.com/zitadel/nextgen/commit/7a06425a1b30a448bf05da8d870bd4570d304060)]:
  - @zitadel/api@1.0.0-alpha.21
  - @zitadel/components@1.0.0-alpha.21
  - @zitadel/sdk-core@1.0.0-alpha.21

## 1.0.0-alpha.20

### Patch Changes

- Updated dependencies [[`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b), [`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b), [`de7534a`](https://github.com/zitadel/nextgen/commit/de7534aa6a140e9ea32173a59694c71e61214e7b)]:
  - @zitadel/components@1.0.0-alpha.20
  - @zitadel/api@1.0.0-alpha.20
  - @zitadel/sdk-core@1.0.0-alpha.20

## 0.1.0-alpha.19

### Patch Changes

- [#856](https://github.com/zitadel/nextgen/pull/856) [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344) Thanks [@fforootd](https://github.com/fforootd)! - The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.

- Updated dependencies [[`d1e967d`](https://github.com/zitadel/nextgen/commit/d1e967d74ee339f9695f73185dd3097b19f527a2), [`c2888bd`](https://github.com/zitadel/nextgen/commit/c2888bdfd3c2a21fefd76a9b7fa80507d97cd88b), [`61a0eee`](https://github.com/zitadel/nextgen/commit/61a0eee0abb310a834d94b72a74f351035021be8), [`b17b2c9`](https://github.com/zitadel/nextgen/commit/b17b2c9fb3fae00f99a1864d37f3b51142ea4344), [`fc3d154`](https://github.com/zitadel/nextgen/commit/fc3d154f2fabb722c6f94633fd6c10bc60d0a657), [`35d25c3`](https://github.com/zitadel/nextgen/commit/35d25c3add44611197363ff088fc940ee3858c78), [`e26f376`](https://github.com/zitadel/nextgen/commit/e26f37617f5d3a3f92f00c07aad89a98ee9d754f), [`b7235f7`](https://github.com/zitadel/nextgen/commit/b7235f7a0ede460e504376974b370d3d95e0d3c6), [`f1049fd`](https://github.com/zitadel/nextgen/commit/f1049fd1b07086ffd070ecdd0b2d80958efd72f2), [`37e9cb9`](https://github.com/zitadel/nextgen/commit/37e9cb903943d34eebadfb44457872892f296823), [`11e6ab5`](https://github.com/zitadel/nextgen/commit/11e6ab57d611f4dc0f9732b958bff1302d4ea689), [`11e6ab5`](https://github.com/zitadel/nextgen/commit/11e6ab57d611f4dc0f9732b958bff1302d4ea689)]:
  - @zitadel/components@0.1.0-alpha.19
  - @zitadel/api@0.1.0-alpha.19
  - @zitadel/sdk-core@0.1.0-alpha.19

## 0.1.0-alpha.18

### Minor Changes

- [#713](https://github.com/zitadel/nextgen/pull/713) [`9eaa610`](https://github.com/zitadel/nextgen/commit/9eaa61022101b4af1fa8bac77864fee22486c2f7) Thanks [@fforootd](https://github.com/fforootd)! - The CLI now enforces its supported framework floors — Next.js 15 and newer, React 18 and newer. `setup` refuses a below-floor app before making any change, and `doctor` reports one the same way: both emit an explicit `E_UNSUPPORTED_PROJECT_SHAPE` error naming the floor together with an upgrade hint. Only version ranges that provably cannot resolve to a supported release are rejected — protocol specs (`file:`, `workspace:`), dist-tags (`latest`), and ranges that admit a supported version all pass. `@zitadel/sdk-next` now declares the matching peer range `next >=15`.

- [#686](https://github.com/zitadel/nextgen/pull/686) [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c) Thanks [@fforootd](https://github.com/fforootd)! - New types-only `@zitadel/sdk-next/jsx` entry that forwards the `@zitadel/components/jsx` React JSX declarations, so Next.js apps that only depend on the SDK can type the `<zitadel-*>` elements in TSX. `@zitadel/sdk-next/client` additionally re-exports the `businessLocales` overlay.

- [#717](https://github.com/zitadel/nextgen/pull/717) [`cb42772`](https://github.com/zitadel/nextgen/commit/cb427725b28a650739c5c86e72187f3df1529570) Thanks [@fforootd](https://github.com/fforootd)! - Give the embedding app a supported way to read session state for its own chrome (header navigation, account menus) — previously the widgets read `GET /sessions/me` internally but the host page had no documented path to the same answer and kept rendering signed-out CTAs beside a live session.
  - `@zitadel/sdk-next` ships a new `@zitadel/sdk-next/session` entry with `getSession()`: a client-side read of the same-origin `{proxyPath}/sessions/me` (the exact read `<zitadel-session>` performs). Works on any page — unlike server-side `auth()` it does not require the route to be covered by the middleware `matcher` — and returns the client-safe `ClientAuthResult` (`userId`/`email`/`name`, no token). 401, the backend's JSON 404, and anonymous sessions map to signed-out; other failures — including a framework's HTML 404 from a misrouted proxy — throw instead of silently rendering signed-out.
  - The client-safe auth shapes (`ClientSession`, `ClientAuthState`, `ClientAuthResult`) move to `@zitadel/sdk-core` as the single source; `@zitadel/sdk-nuxt` re-exports them unchanged, so its `useAuth()` and sdk-next's `getSession()` now return the identical shape.
  - CLI scaffold guidance (`AGENTS.md` managed section) and the generated profile pages now name each framework's session read: `getSession()` on Next, the auto-imported `useAuth()` composable on Nuxt, and the raw `/__nextgen/sessions/me` read for the SPA frameworks.

- [#718](https://github.com/zitadel/nextgen/pull/718) [`fc441fe`](https://github.com/zitadel/nextgen/commit/fc441fed87b8f15c1b17ccdda07272d61803c862) Thanks [@fforootd](https://github.com/fforootd)! - Harden the sdk-next auth surface: verify the tunnelled session token, and keep the raw token out of client-side JavaScript.
  - **`auth()` now verifies instead of trusts.** Previously it decoded the `x-nextgen-auth-token` header without verification and treated any other non-empty value as a middleware-validated opaque token — on routes outside the middleware `matcher`, a client-supplied header could spoof any identity. `auth()` now re-verifies every value: JWTs cryptographically via JWKS (same rules and defaults as the middleware, in-process key cache), opaque tokens against `GET /sessions/me` (deduplicated per render pass via React `cache()`), failing closed on anything unverified. Opaque sessions also gain the real identity (`userId`/`email`/`name` from the backend) instead of `userId: "unknown"`. New optional `AuthOptions` mirror the middleware's verification options for apps that customise them.
  - **`NextgenProvider` strips the session token server-side.** Passing `await auth()` into the provider previously serialised the raw token into the RSC flight payload, readable by any client script. The provider is now a shared component that converts to the client-safe `ClientAuthResult` before the value crosses the server→client boundary, so client components only ever see `userId`/`email`/`name` — matching sdk-nuxt, which already stripped the token from its SSR payload. `useAuth()` returns `ClientAuthResult` accordingly.
  - **New `@zitadel/sdk-next/react` entry** for client components (`useAuth`, `AuthContextProvider`). `NextgenProvider` itself is **server-only** (exported from `@zitadel/sdk-next/server` and the root): it accepts the token-bearing `auth()` result, so re-exporting it through a `"use client"` wrapper would serialise the raw token across the boundary before the strip runs — the `server-only` guard turns that wrapper into a build error. Client-seeded trees (e.g. from `getSession()`) use `AuthContextProvider`, which only accepts the token-less shape. The package root is likewise a server-module surface. The package also builds as per-file modules now, fixing `"use client"` directives that were previously lost in bundled chunks — the provider/hook entries were unusable from published builds.
  - **`opaqueTokenTimeoutMs` is honoured.** The Next middleware silently ignored the documented option and reused `jwksTimeoutMs` for its `GET /sessions/me` validation; both the middleware and `auth()` now thread `opaqueTokenTimeoutMs` (default 5000 ms), matching sdk-nuxt.
  - `@zitadel/sdk-core` exports `isJwtShaped()` (JWS vs JWE structural detection), shared by the middleware and `auth()`.

### Patch Changes

- [#719](https://github.com/zitadel/nextgen/pull/719) [`b37f23b`](https://github.com/zitadel/nextgen/commit/b37f23bc68cce7ba2ed0f0c2aac081de73f1c70d) Thanks [@fforootd](https://github.com/fforootd)! - Session-state reads now bypass caches and only canonical Zitadel 401/404 error
  responses are treated as signed out, including expired or superseded session
  cookies. The browser-only `getSession` helper and its options type now live on
  the dedicated `@zitadel/sdk-next/session` entry instead of the package root.
  Framework proxies attach the project secret only to the exact
  `POST /sessions/exchange` handoff operation, so browser-reachable public and
  management paths no longer receive an infrastructure-supplied operator
  credential. After upgrading the CLI, run `zitadel doctor --fix` to migrate the
  legacy managed Vite and Angular proxy hooks. Doctor warns when an unrecognized
  proxy may still over-forward the project secret; custom proxy implementations
  remain user-owned and must be reviewed manually.
- Updated dependencies [[`7120ce3`](https://github.com/zitadel/nextgen/commit/7120ce328eb9c63bbc6ff0bad0465c7f1f49e602), [`ff66683`](https://github.com/zitadel/nextgen/commit/ff66683eeb0daa3a12e7d11fed01076ac8c2ba58), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`7ea32f8`](https://github.com/zitadel/nextgen/commit/7ea32f82b582e37944535b537940f035bdda8cde), [`2c63b47`](https://github.com/zitadel/nextgen/commit/2c63b47c025e1255683b0b8cd2c48a3e25f79b3a), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`1f66979`](https://github.com/zitadel/nextgen/commit/1f6697956ee81a5a28812905283ddb94f649250f), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`310014f`](https://github.com/zitadel/nextgen/commit/310014f1ec8df441b161d12bb01658d27aa1f478), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`d2bca36`](https://github.com/zitadel/nextgen/commit/d2bca36bdaa09168363e8e581cc4f0ef5db7eeb8), [`e0b8d3d`](https://github.com/zitadel/nextgen/commit/e0b8d3d66356f80d658198edccca3d6d77077c29), [`97470b2`](https://github.com/zitadel/nextgen/commit/97470b2d51fdf815463336ffe7999f864e510f13), [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c), [`ca91e8f`](https://github.com/zitadel/nextgen/commit/ca91e8f0368a59f9b96df2f380ec708b3b678f6c), [`e58a4c1`](https://github.com/zitadel/nextgen/commit/e58a4c1161d11d519d04cb944ab2875270ddc8c2), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`4b984af`](https://github.com/zitadel/nextgen/commit/4b984afbbde622b6f86d90ff327f4b21f9526785), [`40c8537`](https://github.com/zitadel/nextgen/commit/40c8537efc12203fce05855b9536500a4a78621a), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`6394228`](https://github.com/zitadel/nextgen/commit/6394228f61426eed4bd28d0df781a98b42a9ac95), [`1395911`](https://github.com/zitadel/nextgen/commit/1395911519a40ceb4e06e8b68729376553d2768d), [`cb42772`](https://github.com/zitadel/nextgen/commit/cb427725b28a650739c5c86e72187f3df1529570), [`e375e18`](https://github.com/zitadel/nextgen/commit/e375e1811b9d03ceae8b517cf2230f52957e8a5c), [`f2cec14`](https://github.com/zitadel/nextgen/commit/f2cec1417437c4f7d33dc4bd2281b802cfebe406), [`41a2de2`](https://github.com/zitadel/nextgen/commit/41a2de240cb446cd12b438a442a55e7b90287e80), [`2975c4d`](https://github.com/zitadel/nextgen/commit/2975c4dabec68ac1a8569d6a34960de50dced1b8), [`fc441fe`](https://github.com/zitadel/nextgen/commit/fc441fed87b8f15c1b17ccdda07272d61803c862), [`2ece0b1`](https://github.com/zitadel/nextgen/commit/2ece0b1242b07b7e369668bd4d313b44d56e553c), [`65da8b1`](https://github.com/zitadel/nextgen/commit/65da8b18b8a1af4e484d7cf494f8142f0539fb41)]:
  - @zitadel/api@0.1.0-alpha.18
  - @zitadel/components@0.1.0-alpha.18
  - @zitadel/sdk-core@0.1.0-alpha.18

## 0.1.0-alpha.17

### Patch Changes

- Updated dependencies [[`79d4179`](https://github.com/zitadel/nextgen/commit/79d417924518c9ea272136db1f46aaf237497999), [`363482e`](https://github.com/zitadel/nextgen/commit/363482e27c88ac96c9a2b48c880e5caa5a4dcf65), [`a0b39a1`](https://github.com/zitadel/nextgen/commit/a0b39a119408a6fa02e8e1e45ebd5dd14b96c01b)]:
  - @zitadel/components@0.1.0-alpha.17
  - @zitadel/api@0.1.0-alpha.17
  - @zitadel/sdk-core@0.1.0-alpha.17

## 0.1.0-alpha.16

### Patch Changes

- Updated dependencies [[`e4d55d2`](https://github.com/zitadel/nextgen/commit/e4d55d22c64d28a19597718417af6447a66a5852), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`1eec59e`](https://github.com/zitadel/nextgen/commit/1eec59ee924cc2b12df11f5541d6a2eef8caa6c2), [`754c7f6`](https://github.com/zitadel/nextgen/commit/754c7f6d8b970438a5ffa2c5c57ef72a2b5ed657), [`e9593cd`](https://github.com/zitadel/nextgen/commit/e9593cd4f74f5ebc010150a2ed8a3ae03b7d5d87), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`bdf2906`](https://github.com/zitadel/nextgen/commit/bdf29064ab783f1d14ea554f3512bf243e86d3b5), [`e73d55f`](https://github.com/zitadel/nextgen/commit/e73d55f57e86db53464ac112f8a362a3da327a19), [`69b6b6a`](https://github.com/zitadel/nextgen/commit/69b6b6a0fa934cbbd81deba46192b3b1346612a8)]:
  - @zitadel/components@0.1.0-alpha.16
  - @zitadel/sdk-core@0.1.0-alpha.16
  - @zitadel/api@0.1.0-alpha.16

## 0.1.0-alpha.15

### Patch Changes

- Updated dependencies [[`f45d47c`](https://github.com/zitadel/nextgen/commit/f45d47c5850edc83a55b5ad7364a59ffac4fd37c)]:
  - @zitadel/components@0.1.0-alpha.15
  - @zitadel/api@0.1.0-alpha.15
  - @zitadel/sdk-core@0.1.0-alpha.15

## 0.1.0-alpha.14

### Minor Changes

- [#443](https://github.com/zitadel/nextgen/pull/443) [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630) Thanks [@bastionstack](https://github.com/bastionstack)! - Add a post-sign-in `<zitadel-session>` "signed in as" card: a dedicated element exposed through every SPA SDK and re-exported from sdk-next. CLI scaffolds now render it as the post-sign-in `/profile` page (with a Logout action) across all frameworks. Identity is read from `GET /sessions/me`, preferring `name` then `email` then `user_id`.

  `<zitadel-logout>` now sources its identity from the same `getMySession` operation instead of the `__nextgen_display` cookie, so both signed-in surfaces work against the real backend. Both components route their `getMySession`/`revokeMySession` calls through the shared `api-client` wrappers that enforce `credentials: "include"`.

### Patch Changes

- Updated dependencies [[`54dcc87`](https://github.com/zitadel/nextgen/commit/54dcc87084dd2d2b8314d08221354683bae64c6b), [`605abe1`](https://github.com/zitadel/nextgen/commit/605abe1f04a011c05bd4be2179556052eae6c007), [`ea193dc`](https://github.com/zitadel/nextgen/commit/ea193dc0fabdf3c49fa9c3e3bae4cf242001d630)]:
  - @zitadel/components@0.1.0-alpha.14
  - @zitadel/api@0.1.0-alpha.14
  - @zitadel/sdk-core@0.1.0-alpha.14

## 0.1.0-alpha.13

### Patch Changes

- Updated dependencies [[`b574f3a`](https://github.com/zitadel/nextgen/commit/b574f3a6e6122439fadd6f971b73a61b8554f293)]:
  - @zitadel/api@0.1.0-alpha.13
  - @zitadel/components@0.1.0-alpha.13
  - @zitadel/sdk-core@0.1.0-alpha.13

## 0.1.0-alpha.12

### Patch Changes

- Updated dependencies [[`2c32a90`](https://github.com/zitadel/nextgen/commit/2c32a90b41bdc7da736a2c3be0e8e851dbe59333), [`237c3c7`](https://github.com/zitadel/nextgen/commit/237c3c73a319e74c1411e3b04a1bb1a0e9d91051), [`a2f6526`](https://github.com/zitadel/nextgen/commit/a2f65266e00ee461e8e7fb1dee35e5add30b7199)]:
  - @zitadel/components@0.1.0-alpha.12
  - @zitadel/api@0.1.0-alpha.12
  - @zitadel/sdk-core@0.1.0-alpha.12

## 0.1.0-alpha.11

### Patch Changes

- [#310](https://github.com/zitadel/nextgen/pull/310) [`050f5d7`](https://github.com/zitadel/nextgen/commit/050f5d7a39a2a9160346276203e8da82db137478) Thanks [@mridang](https://github.com/mridang)! - CLI scaffolds now write the project service-key secret to `.env.local` as `ZITADEL_PROJECT_SECRET`, and the React/Vue/Angular dev proxies plus the Next.js and Nuxt server middlewares send it as the bearer on every proxied request instead of synthesising `sk_<project_id>` from the public project id. The secret stays server-side: `.env.local` is gitignored, Vite only exposes `VITE_`-prefixed vars to the client, Next.js auto-loads `.env.local` into `process.env` server-side, and the Nuxt module reads `process.env.ZITADEL_PROJECT_SECRET` in its `setup()` and pushes it into Nuxt's server-only `runtimeConfig.nextgen.projectSecret` (overridable at deploy time via `NUXT_NEXTGEN_PROJECT_SECRET`).

  Also drops the unused `onExchangeResponse` hook from `NextgenMiddlewareOptions` (no callers anywhere; alpha so no external usage to break).

- Updated dependencies [[`76e7381`](https://github.com/zitadel/nextgen/commit/76e7381f796ca04a7d34f349c456ee172dc714b6), [`0b81768`](https://github.com/zitadel/nextgen/commit/0b8176857395d25c95343b5b320d074e0ba2c102), [`050f5d7`](https://github.com/zitadel/nextgen/commit/050f5d7a39a2a9160346276203e8da82db137478)]:
  - @zitadel/sdk-core@0.1.0-alpha.11
  - @zitadel/components@0.1.0-alpha.11
  - @zitadel/api@0.1.0-alpha.11

## 0.1.0-alpha.10

### Patch Changes

- Updated dependencies [[`acb5b54`](https://github.com/zitadel/nextgen/commit/acb5b549386efcc5ede005871b145c1cd0f9ac5e)]:
  - @zitadel/components@0.1.0-alpha.10
  - @zitadel/api@0.1.0-alpha.10
  - @zitadel/sdk-core@0.1.0-alpha.10

## 0.1.0-alpha.9

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.9
  - @zitadel/components@0.1.0-alpha.9
  - @zitadel/sdk-core@0.1.0-alpha.9

## 0.1.0-alpha.8

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.8
  - @zitadel/components@0.1.0-alpha.8
  - @zitadel/sdk-core@0.1.0-alpha.8

## 0.1.0-alpha.7

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.7
  - @zitadel/components@0.1.0-alpha.7
  - @zitadel/sdk-core@0.1.0-alpha.7

## 0.1.0-alpha.6

### Patch Changes

- Updated dependencies [[`30b4b41`](https://github.com/zitadel/nextgen/commit/30b4b411a9c99fc61d991f739636f93d7bee5b1d)]:
  - @zitadel/components@0.1.0-alpha.6
  - @zitadel/api@0.1.0-alpha.6
  - @zitadel/sdk-core@0.1.0-alpha.6

## 0.1.0-alpha.5

### Patch Changes

- Updated dependencies [[`f77ca44`](https://github.com/zitadel/nextgen/commit/f77ca44e85565976d26de0b6444b7fc5b1616e8c), [`3795b67`](https://github.com/zitadel/nextgen/commit/3795b6793c72b92300fc6a7d21c7562f0a25343e)]:
  - @zitadel/components@0.1.0-alpha.5
  - @zitadel/api@0.1.0-alpha.5
  - @zitadel/sdk-core@0.1.0-alpha.5

## 0.1.0-alpha.4

### Patch Changes

- Updated dependencies [[`ce237ef`](https://github.com/zitadel/nextgen/commit/ce237ef355422c666769eef20df78bdc8ec0e0f9)]:
  - @zitadel/components@0.1.0-alpha.4
  - @zitadel/api@0.1.0-alpha.4
  - @zitadel/sdk-core@0.1.0-alpha.4

## 0.1.0-alpha.3

### Patch Changes

- Updated dependencies []:
  - @zitadel/api@0.1.0-alpha.3
  - @zitadel/components@0.1.0-alpha.3
  - @zitadel/sdk-core@0.1.0-alpha.3

## 0.1.0-alpha.2

### Patch Changes

- Updated dependencies [[`b0094f4`](https://github.com/zitadel/nextgen/commit/b0094f4255854c571664e746f70447c365c52af2), [`ce89c59`](https://github.com/zitadel/nextgen/commit/ce89c5941b4ae90849fac720ecc4a2a0c49c245d), [`01aed1e`](https://github.com/zitadel/nextgen/commit/01aed1e0de4ffd1ec6d78f8fa73f0ce19b907aa0), [`09aa2b1`](https://github.com/zitadel/nextgen/commit/09aa2b13da9dd0e15453f46f4d62fb2863835a0c), [`c097a5f`](https://github.com/zitadel/nextgen/commit/c097a5f0b720e58920c692ec909960e9c44696e3)]:
  - @zitadel/api@0.1.0-alpha.2
  - @zitadel/components@0.1.0-alpha.2
  - @zitadel/sdk-core@0.1.0-alpha.2

## 0.1.0-alpha.0

### Minor Changes

- [#206](https://github.com/zitadel/nextgen/pull/206) [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de) Thanks [@IAM-marco](https://github.com/IAM-marco)! - Wire up the end-to-end passkey registration and login flow across the
  API, component, and SDK surfaces:
  - `@zitadel/api`: expose the passkey registration OpenAPI contract to the
    generated TypeScript client.
  - `@zitadel/components`: refresh the `<zl-passkey>` atom and the
    `<zitadel-login>` orchestrator templates (consolidated `default.liquid` +
    `layout-chrome.css`, dropped the standalone passkey-upsell/signed-in
    partials) and expand the `en`/`de` locale strings for the passkey steps.
  - `@zitadel/sdk-next`: extend `auth` and the request `middleware` to drive the
    passkey register/login round-trip.
  - `@zitadel/sdk-core`: adjust JWT handling to support the flow.

- [#209](https://github.com/zitadel/nextgen/pull/209) [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703) Thanks [@bastionstack](https://github.com/bastionstack)! - Rename the public packages to the `@zitadel` scope and publish them to npm via changesets with GitHub OIDC trusted publishing. This is the first `@zitadel/*`-scoped release line, cut as an `alpha` prerelease.

### Patch Changes

- [#208](https://github.com/zitadel/nextgen/pull/208) [`e7ec7e9`](https://github.com/zitadel/nextgen/commit/e7ec7e9f2e9e9559ddc1b728a0c7a5e6fb0d08fb) Thanks [@mridang](https://github.com/mridang)! - `zitadel setup` no longer scaffolds or uploads the user schema and flow definition — the Zitadel server now provisions these defaults when a project is created. Setup no longer writes `.zitadel/schemas/user.json` or `.zitadel/flows/default.json`, runs no sync step at the end, and the `--no-apply` flag (which only gated that sync) has been removed. The sync engine and the hidden `apply`/`plan` commands remain in place for a future pull-based workflow.

  **Behavior change for non-interactive callers.** `zitadel setup --no-apply` is no longer a valid flag and will error; remove it from scripts and agents.

  Scaffolded Next.js login/register/profile pages now configure the SDK via `configureZitadel(...)` and pass the resulting project handle to the `<zitadel-login>` / `<zitadel-logout>` web components through the `project` prop, instead of the removed `api-base` / `project-id` attributes. To support an app that declares only `@zitadel/sdk-next` as a direct dependency, `@zitadel/sdk-next/client` now re-exports `configureZitadel` and `getApi`.

- [#73](https://github.com/zitadel/nextgen/pull/73) [`b118f74`](https://github.com/zitadel/nextgen/commit/b118f742cbd9e21cbb4616f36386f09f72a3cc69) Thanks [@bastionstack](https://github.com/bastionstack)! - Replace the `@nextgen/ui-lit` placeholder web components with the real
  `@zitadel/components` library across the demos and SDK packages.
  - Add `<zitadel-logout>`: an orchestrator-tier element built on the same
    design-token system as `<zitadel-login>`. It reads the `__nextgen_display`
    cookie, renders an avatar trigger + dropdown by default, and supports a
    `<template>`-slot mode with `{{name}}`, `{{email}}`, `{{initial}}`
    substitutions and `data-action="logout"` triggers. Fires `zitadel-signout`
    on completion.
  - Add `proxy-base` and `post-sign-in-url` attributes to `<zitadel-login>`.
    When `proxy-base` is set the orchestrator drives a new `ProxyTransport`
    against the SDK's `/__nextgen` proxy; `post-sign-in-url` navigates after a
    terminal step. `<zitadel-logout>` exposes `proxy-base` and
    `post-sign-out-url` for the symmetric flow.
  - Add `ProxyTransport`: a same-origin transport that speaks the
    `/v1/flow {action,email,password}` shape exposed by the
    `feat/sdk-packages` mock server / SDK proxy. Synthesises a single-step
    `FlowResponse` with `email` + `password` fields so the existing
    orchestrator + atom pipeline renders against it unchanged.
  - Drop the `@nextgen/ui-lit` package and switch `@zitadel/sdk-next`,
    `@zitadel/sdk-nuxt`, and the `apps/demo-next` / `apps/demo-nuxt` apps to
    re-export and consume `@zitadel/components` instead. Existing
    `<nextgen-login>` / `<nextgen-logout>` tags become `<zitadel-login>` /
    `<zitadel-logout>` with the same `proxy-base` and post-sign-{in,out}-url
    attributes.

- Updated dependencies [[`5761ad2`](https://github.com/zitadel/nextgen/commit/5761ad2a2914d328203f5863b120e95300c60a22), [`c82ed55`](https://github.com/zitadel/nextgen/commit/c82ed5564e949bf8fe73f449db9a2718b50e7edf), [`0fa3fc9`](https://github.com/zitadel/nextgen/commit/0fa3fc9a5ec7f85f8d5ab771737e87decab8b404), [`b118f74`](https://github.com/zitadel/nextgen/commit/b118f742cbd9e21cbb4616f36386f09f72a3cc69), [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de), [`c9b83b7`](https://github.com/zitadel/nextgen/commit/c9b83b7a2f17d196ddf7152079d73286d22d4eba), [`3aa1d5f`](https://github.com/zitadel/nextgen/commit/3aa1d5f62af87fe4b6658dbed914bac515e3f0de), [`8a8d417`](https://github.com/zitadel/nextgen/commit/8a8d417923754d58c3967839ebc9ebf84154531b), [`fdabcff`](https://github.com/zitadel/nextgen/commit/fdabcffb28a0058375d97f671152ebb3075f3703)]:
  - @zitadel/sdk-core@0.1.0-alpha.0
  - @zitadel/components@0.1.0-alpha.0
  - @zitadel/api@0.1.0-alpha.0
