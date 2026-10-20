# ADR 073: A Session Cookie per Project on a Shared Host

> **Status:** Accepted
> **Date:** 2026-10-19
> **Context:** On `localhost`, signing in to the Console signs a scaffolded app
> out, and signing in to the app signs the Console out. Two apps of different
> projects on one host do the same to each other.
> **Relates to:** [ADR 036](036-api-credential-planes.md) (the `/__nextgen`
> proxy), [ADR 053](053-cross-project-principals.md) §5 (the Console's
> first-party session cookie)
> **Implementation:** ships with this ADR in sdk-core, the six server SDKs and
> `@zitadel/testing`.
> **Amended 2026-10-19:** the dev proxies the CLI writes for the SPA scaffolds
> keep a cookie per project too (see
> [SPA dev proxies](#spa-dev-proxies-amended-2026-10-19)).

## TL;DR

- The server keeps setting and reading `__nextgen_session`. Nothing changes on
  the wire between an SDK and the server.
- The six server SDKs keep their app's session in a cookie of its own,
  `__nextgen_session_<project id>`. Their proxy under `/__nextgen` renames the
  server's cookie on the way to the browser and back on the way to the server,
  and never forwards another project's session cookie.
- The dev proxies the CLI writes for the SPA scaffolds do the same (amended
  2026-10-19).
- The Console, which the server serves on its own origin, keeps
  `__nextgen_session`. The Console and the apps, and apps of different
  projects, stop overwriting each other's session.
- A session of the app's project held under the old name is copied to the new
  name the first time the app checks it, and the old cookie is retired at the
  next sign-in or sign-out through the app.

## Context

A browser keeps one cookie jar per host and ignores the port. Every project's
session lives in the cookie `__nextgen_session` (`Path=/`, host-only): the
server sets it, and the SDK proxies pass it through unchanged. On `localhost`
the Console of `zitadel start` (`:8080`) and every scaffolded app (`:3000`,
`:3001`, …) therefore share one slot, and each sign-in replaces the session of
whoever signed in before.

The server SDKs already count a session only in their app's own project
(`GET /sessions/me?project_id=…`) and leave another project's cookie alone. So
the shared slot costs the developer a sign-in every time they switch between
the Console and an app. It also hands each app's proxy whatever session the
slot holds, so a sign-out in one app can end the Console's session.

## Options

### A. The SDK proxies keep a cookie per project (recommended)

The proxy is the one party that knows, without being told, which project a
browser request belongs to: it serves one app, and every server SDK already
requires that app's project (`projectId`, else `ZITADEL_PROJECT_ID`, else the
framework's public project id variable).

- **Browser-bound:** a `Set-Cookie` for `__nextgen_session` (setting or
  clearing it) leaves the proxy as `__nextgen_session_<project>`, every
  attribute unchanged.
- **Server-bound:** the forwarded `Cookie` header carries the project's cookie
  under the server's name and drops every other session cookie
  (`__nextgen_session` and any `__nextgen_session_*`). `_zflow`, `_zsso` and
  the app's own cookies pass as before.
- **Middleware:** reads the session from the project's cookie, and clears only
  that cookie when it holds a dead session, never another app's.
- **No project configured:** the proxy passes the cookie through unchanged, as
  today; nobody counts as signed in, as today.

No server, API or Console change, and an SDK with this works against old and
new servers alike. What it does not reach: the SPA SDKs' dev proxies, which the
CLI writes into the app's own Vite or Angular config, and pages that call the
server directly. Both keep the server's name, as today.

### B. The server issues project-scoped names

The server sets `__nextgen_session_<project>`. To read one, it has to pick
among all the cookies a browser sends to its host, by a project the request
names: a parameter or header on every cookie-authenticated operation, the
Console's management calls included (ADR 053 §5), whose session project differs
from the project they manage.

- It reaches every client, SPAs and plain pages too.
- The OpenAPI security scheme names one fixed cookie; every client changes with
  it: the Console, the components' API client, the CLI's local sign-in (which
  reads the cookie from `Set-Cookie`), the integration-test helpers and the
  api-mock.
- It breaks mixed versions: an SDK released before the change reads
  `__nextgen_session` from a server that no longer sets it. A server that writes
  both names brings the shared slot back.

### C. Cheaper ways

- **Another loopback name for the Console**, `http://127.0.0.1:8080`: another
  host, so another cookie jar, and no code. But WebAuthn takes no IP address as
  relying party, so passkeys fail there; it separates the Console from the
  apps, not two apps from each other; and every URL the CLI prints and the docs
  show would change.
- **`*.localhost` names** (`console.localhost:8080`): resolve in Chromium and
  Firefox only, and the server leaves `Secure` off on plain http only for
  `localhost` and loopback addresses, so Safari drops the cookie. The same gap
  between apps.
- **A cookie per port in the proxy** (`__nextgen_session_3000`): option A
  keyed by the wrong thing. Two apps of one project on two ports would stop
  sharing their session, and moving an app to another port signs its users out.

## Decision

Option A.

### The name

`__nextgen_session_` followed by the project id, for example
`__nextgen_session_proj_01K7ZD3EXAMPLE`. Project ids (`proj_` and a ULID or a
UUID) are valid in a cookie name; any other character in a configured id is
percent-encoded. Apps of one project share the cookie, as they share users.

sdk-core owns the mapping (the name, the rewrite of both headers, the
middleware's read and its cookie updates), so the six SDKs cannot drift on it.
Their contract tests carry the new cases under canonical titles.

### Existing `__nextgen_session` cookies

Users who signed in before the upgrade hold the app's session under the old
name, and on `localhost` that name may hold the Console's session instead. The
SDK reads the old cookie only where the server holds the answer to the app's
project anyway:

- **Middleware:** with no project cookie, it checks `__nextgen_session` in the
  app's project, as it does today. A session that signs a user in is copied:
  the response sets the project's cookie to the same value, its `Max-Age` from
  the session's `expires_at` (a JWT's `exp`), and leaves the old cookie. On a
  server without platform bootstrap (the Docker Compose quick start, a server
  run by hand) the Console signs in to the app's project, so that cookie may
  be the Console's: clearing it on every page would sign the Console out, and
  the two would keep taking the session from each other. Another project's
  session and an anonymous one keep their cookie untouched; a dead one is
  cleared, as today. The middleware remembers for a few minutes which tokens
  the server placed in another project (by a hash), so a signed-out visitor's
  requests do not ask about the Console's session again.
- **Proxy:** with no project cookie, it forwards `__nextgen_session` to one
  call only, `GET /sessions/me?project_id=<project>`, the probe the widgets and
  `getSession()` send, which the server refuses for another project's session.
  An answer that signs a user in copies the cookie the same way. This covers a
  Next.js page outside the middleware `matcher`, which never runs the middleware.
  Every other proxied call goes without the old cookie.
- **Sign-in and sign-out:** left in place, the old cookie would sign its user
  back in once the app's own cookie is gone: after a sign-out, or once a newer
  session the app signed in expires. So when `POST /sessions/exchange` sets the
  app's session, or `DELETE /sessions/me` ends it, and the browser still holds
  `__nextgen_session`, the proxy asks the server about that session in the
  app's project (`GET /sessions/me?project_id=<project>`). A session of the
  project is cleared, and on sign-out also ended; a dead one is cleared; one of
  another project, the Console's on `localhost`, stays, and so does one the
  server gave no verdict on.
- **Cookie attributes:** every response that sets a session cookie sends
  `Cache-Control: private, no-store`, as the server does on its session
  answers, so no shared cache hands a session token to the next visitor.
  `Secure` follows the server's rule on the scheme and host a proxy in front of
  the app forwarded (`X-Forwarded-Proto`, `X-Forwarded-Host`), so an app behind
  a TLS proxy that talks to it over loopback keeps it.

Old and new SDKs on one host: an SDK from before this change still clears every
`__nextgen*` cookie when its own session is dead, the new apps' cookies
included. Upgrading it ends that.

### What else changes

- **The Console** (`apps/console`): nothing. It is served by the server on the
  server's origin and keeps `__nextgen_session`.
- **The api-mock** (`packages/api-mock`): nothing. It stands in for the server;
  the demos' SDK proxies rename in front of it, as they do in front of the real
  one.
- **`@zitadel/testing`**: `SESSION_COOKIE_NAME` stays the server's name, the
  one direct calls to the server use, and an SPA whose dev proxy knows no
  project. A new
  `sessionCookieName(projectId)` names the cookie a server SDK keeps. The
  `authenticatedPage` fixture signs its browser context in under both names,
  so it works on either kind of app.
- **e2e lanes**: `e2e/demo-next` (mock and real lanes) and `e2e/demo-nuxt` look
  for the demo project's cookie after sign-in. `e2e/journey` and the testkit
  suite it scaffolds look for the project's cookie on every framework, after
  sign-in and after sign-out.
  `e2e/console` signs in through the UI and names no cookie.
- **Docs**: the SDK proxy page says which cookie holds an app's session, and
  why; the testing kit's README names both cookies.

### SPA dev proxies (amended 2026-10-19)

The SPA scaffolds have no server SDK. In development the CLI writes a
`/__nextgen` proxy into the app: an entry in `vite.config.*` for React, Vue,
Solid, Svelte and Qwik, and `proxy.conf.cjs` for Angular. Both passed cookies
through, so on `localhost` an SPA and the Console still shared a slot.

- **The same mapping, in the generated code.** The generated proxy gets a
  request hook, which sends the app's cookie upstream under the server's name
  and keeps every other session cookie back, and a response hook, which renames
  the server's `Set-Cookie` to the app's name. Vite's proxy (`http-proxy-3`)
  runs both hooks before the request leaves and before the response headers are
  written. The project is `ZITADEL_PROJECT_ID` from `.env.local`, which setup
  writes for every framework, read the way the project secret already is.
  Without it the proxy passes cookies through.
- **Not a published helper.** A dev-proxy helper exported from sdk-core would
  turn future proxy changes into a version bump instead of a config migration.
  It would also need a Node-side public entry point, and a direct
  `@zitadel/sdk-core` dependency in every SPA app, since pnpm does not expose
  transitive dependencies to the app. Angular's CommonJS `proxy.conf.cjs`
  would have to `require` an ESM-only package, or move to `.mjs` with an
  `angular.json` migration. Existing apps would still need the migration below.
  The generated code keeps the exchange-only bearer policy in the same place,
  where `doctor` reviews it. The helper can come with ADR 036's publishable key,
  which rewrites these proxies anyway.
- **No move of old sessions.** Moving a session out of the shared cookie needs
  the probe's answer before the response headers go out (`selfHandleResponse`).
  Only the developer's own dev session sits under the old name, so they sign in
  to the SPA once more. Production SPAs, behind a proxy of their own, keep the
  server's name: a production host serves one project, and the SPA never reads
  the cookie.
- **Existing apps.** `doctor --fix` recognizes the proxy the CLI wrote and adds
  the two cookie hooks next to its bearer hook, leaving the user's changes
  elsewhere alone: in `vite.config.*`, the `/__nextgen` entry with the
  `zitadel:proxy:v2` marker and the generated bearer hook, however a formatter
  laid it out since (quotes, semicolons, arrow parentheses, line ends); in
  `proxy.conf.cjs`, the managed file with its generated hooks. Setup does not:
  it leaves an app that is already set up alone. It is a `convenience` wiring:
  until it is applied, `doctor` warns instead of failing, because sign-in works
  without it, and names `doctor --fix` as the remedy. A proxy the CLI does not
  recognize is left alone and keeps the shared cookie, and `doctor` warns that
  the hooks must be added by hand.

### Not covered

- **`_zflow` and `_zsso`** stay one per host: of two sign-ins in progress at
  once on one host, in the Console and in an app, the one whose flow cookie the
  other replaced fails and has to start again. A flow cookie lives ten minutes.
- **One project id on two servers.** The name carries the project, not the
  server. Ids the server mints are unique, but fixed ones are not: two local
  servers' Consoles (`proj_platform` on each, under the server's name anyway),
  or the two demos (`proj_demo`) run against two mocks, still share a cookie.

## Consequences

- On `localhost` the Console and each app keep their own session; signing in to
  one leaves the others signed in.
- A sign-out through an app's proxy ends that app's session only.
- Users of an upgraded app stay signed in; the copy happens on their first
  request the middleware or the session probe sees, and the old cookie goes at
  their next sign-in or sign-out through the app. On a server where the Console
  shares the app's project, that sign-in or sign-out also signs the Console out
  in this browser.
- The browser holds one more cookie per project signed in on a host.
