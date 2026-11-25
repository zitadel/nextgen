# @zitadel/sdk-core

The runtime contract that every Zitadel framework SDK is built on. It holds the
code the SDKs must agree on: how a session is judged, how a JWT is verified,
what the sign-in widgets emit and accept, and how the browser reads the current
session. Application code normally installs a framework SDK (`sdk-next`,
`sdk-nuxt`, or one of the SPA SDKs) and never imports this package. Reach for it
when you write your own middleware, or when you need the widget types without a
framework wrapper.

## Main components

- {@link middleware!resolveSession}: judges one request's session (a bearer JWT, a JWT
  cookie or an opaque session cookie) and returns who is signed in. Every
  server SDK's middleware calls it, so they all apply the same rules.
- {@link jwt!verifyJwt}: verifies a JWT's signature and claims against the
  issuer's key set, without a Node-only dependency.
- {@link middleware!proxySessionCookies}: carries the app's session cookie across the
  same-origin proxy, in both directions.
- {@link session!getSession} and {@link session!sessionStore}: the browser's one read of the
  current session, and the shared, subscribable store the SPA SDKs bind their
  hooks and composables to.
- {@link types!ZitadelLoginProps}, {@link types!ZitadelLogoutProps} and
  {@link types!ZitadelSessionProps}: the props every framework wrapper exposes for
  the `<zitadel-login>`, `<zitadel-logout>` and `<zitadel-session>` widgets.
- {@link index!resolveZitadelRuntimeEnv}: reads the project id, environment and
  issuer from environment variables and fails startup if they are missing.

## How it works

The sign-in UI is a set of web components, and each SDK wraps them for its
framework. This package owns the contract between the two: the widget
configuration ({@link types!ZitadelLoginConfig} and its siblings), the event payloads
({@link types!ZitadelFlowStepDetail}, {@link types!ZitadelFlowCompleteDetail}, ...) and the
callback props derived from them. Defining it once means a change to an event
reaches every SDK, and the SDKs cannot drift apart.

Nothing in the browser talks to the auth backend directly. The widgets and
{@link session!getSession} call a same-origin proxy under the path `/__nextgen`
(configurable with `proxyPath`), which the SDK's server middleware serves. The
session cookie is therefore first-party and needs no CORS setup. The app keeps
one session cookie per project, so apps and the Console on one host do not read
or replace each other's sessions; {@link middleware!sessionCookieName} gives its name.

A session counts as signed in only for the app's own project. A session of
another project reads as signed out but keeps its cookie, and a backend that
gives no verdict (a `5xx`, a timeout) is reported as undecided instead of
signing the user out.

## Edge runtimes

Every entry point loads without a DOM and without Node built-ins, so the
package works on Cloudflare Workers and Vercel Edge. JWT verification uses the
Web Crypto API and `fetch`. {@link session!sessionStore} on the server never reads
anything: it renders the `loading` snapshot, and the browser starts the real
read after hydration. {@link index!resolveZitadelRuntimeEnv} falls back to an empty
environment where `process` does not exist, so pass the variables in
explicitly on a runtime that exposes them another way.

## Where to go next

- `@zitadel/sdk-core/types`: the widget event, config, handler and props types.
- `@zitadel/sdk-core/middleware`: the middleware layer, session judgement and
  cookie handling.
- `@zitadel/sdk-core/jwt`: JWT decoding and verification.
- `@zitadel/sdk-core/session`: the browser's session read and store.
- The [README on GitHub](https://github.com/zitadel/nextgen/tree/main/packages/sdk-core#readme)
  describes the verification pipeline and the session cookie in detail.
