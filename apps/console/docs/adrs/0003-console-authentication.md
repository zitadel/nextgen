# Console ADR 0003: Console authentication via the embedded login widget

> **Status:** Proposed
> **Date:** 2026-07-23 (revised 2026-08-12 — §4/Consequences: the ADR 0002
> `/api` shim this ADR narrowed was withdrawn, not built; revised 2026-08-13
> — the first-party session becomes a management credential under root ADR 052)
> **Scope:** `apps/console`. See
> [`apps/console/AGENTS.md`](../../AGENTS.md).
> **Context:** Follows the forward-looking slot recorded in
> [Console ADR 0002 §5](0002-console-api-access.md).

## Context

ADR 0002 shipped the console with **no console-user authentication**: before
sign-in the browser held no session, and the dev-only Vite proxy injected the
project-secret bearer — explicitly labelled in
[`vite.config.mts`](../../vite.config.mts) as _"a temporary pre-login
workaround: once the console has a login, a proxy forwards the auth cookie as
the bearer and the secret is dropped."_ This ADR designs that login.

The platform already has everything a console sign-in needs:

- `<zitadel-login>` (the Lit orchestrator in `@zitadel/components`) runs the
  flow API and, on a terminal `complete: "show"` step, exchanges its
  `handoff_token` (`POST /sessions/exchange`) for the `__nextgen_session`
  HttpOnly cookie, then navigates to `post-sign-in-url`.
- `@zitadel/sdk-react` wraps the widget as real React components
  (`ZitadelLogin`, …) for client-side SPAs — exactly what the console is.
- The API authenticates `GET /sessions/me`, `DELETE /sessions/me`, and
  `GET /users/me` with that cookie
  ([`internal/api/security.go`](../../../../internal/api/security.go)).

Two alternatives were considered for where the login screen lives:

1. **Embed the widget in a console route** (chosen) — one deployment surface,
   no cross-app redirect plumbing, and the ADR 0002 request shape
   (same-origin, no project secret in browser code) already fits the widget's
   needs.
2. **Redirect to a separately hosted login page** — keeps the console free
   of the widget, but needs a return-URL contract between two surfaces, a
   second surface to brand/configure, and still requires all the session
   plumbing in the console anyway. No such platform login surface is
   ADR-defined today, so there is nothing agreed to redirect to.

## Decision

### 1. A `/login` route renders the embedded widget

`src/routes/login.tsx` renders `ZitadelLogin` from `@zitadel/sdk-react` with
`purpose="login"`, binding the app-wide `ZitadelProject` handle exported by
`src/api/zitadel.ts` — the same write-once configuration the API client
derives from (root ADR 016). The widget talks to the same-origin API base;
no new transport, no second client.

Post-sign-in navigation is a full-document `window.location.assign` by the
widget, so the target must be a document path: the route joins the router's
`?next=` (router-relative) with the Vite `BASE_URL` so it lands inside the
deployment prefix (`/ui/console` in production, `/` in dev).

### 2. A pathless `_authed` layout owns the guard and the shell

The route tree gains one level (Console ADR 0001 conventions intact):

```
src/routes/
  __root.tsx          minimal: styles + <Outlet/> + devtools
  login.tsx           shell-less sign-in screen
  _authed.tsx         AppShell + session guard (pathless — URLs unchanged)
  _authed/…           all existing screens, moved verbatim
```

`_authed.tsx#beforeLoad` calls `fetchSession()` (`GET /sessions/me`,
`credentials: "include"`, from `src/auth/session.ts`); without an `active`
session carrying a user it throws
`redirect({ to: "/login", search: { next } })`. The login route runs the
inverse check. `next` is sanitized (`sanitizeNextPath`): only same-app,
router-relative paths are followed, so the parameter cannot become an open
redirect. A short-lived (15 s) cache of the confirmed session keeps
hover-preloads from spamming `/sessions/me`; `null` results are never cached.

### 3. Session-aware chrome, console-local

The sidebar footer shows the signed-in identity from `/sessions/me`
(`name` → `email` → `user_id` fallback, the API's documented hydration
contract) with a menu whose only entry is **Sign out**
(`DELETE /sessions/me`, then navigate to `/login`). This chrome is built
console-local (bucket 2 of the root AGENTS.md styling rule) — the dark-only
`<zitadel-session>`/`<zitadel-logout>` pairs are not theme-portable yet.

A data-load `401` now means "session ended mid-use": the shared error
boundary drops the session cache and redirects to `/login?next=…` instead of
rendering dead-end copy (the hook ADR 0002 §3 anticipated). `403` stays a
rendered state — signed in, but no access.

### 4. The cookie is the embedded Console's human credential

The HttpOnly `__nextgen_session` cookie authenticates the human on same-origin
Console requests. Root
[ADR 052](../../../../docs/adrs/052-cross-project-principals.md) makes that
first-party session an accepted operator-plane credential: the server resolves
the platform-project user from the cookie and authorizes the requested
customer project through ordinary target-scoped assignments. The Console
receives neither a project secret nor a script-readable session bearer.

Login establishes identity, not blanket management authority. A platform role
alone grants no customer-project access, and every management endpoint remains
responsible for its own permission check. Unsafe cookie-authenticated requests
also require the exact-Origin and session-bound-CSRF protections specified by
[ADR 052 §5](../../../../docs/adrs/052-cross-project-principals.md), which
amends ADR 046's SameSite-only conclusion.

`POST /sessions/exchange` still uses root
[ADR 036](../../../../docs/adrs/036-api-credential-planes.md)'s publishable key,
which is browser-safe and origin-scoped. `runtime.json` (Console ADR 0004 §3)
provides it to the login widget.

**Current implementation bridge:** the management gate does not yet resolve
session-derived target permissions. The Vite dev proxy therefore continues to
inject a project secret for management requests, while the embedded build
fails those requests closed. No production `/api` shim or secret injection is
planned. Once ADR 052 lands, the dev proxy drops the secret; the Console client
does not change.

### 5. Recorded caveats

- **Dark-only widget.** The widget's surface CSS still uses the legacy
  dark-only login tokens (root ADR 014 §5), so the login screen renders the
  dark treatment in both console themes. Accepted for v1; resolves with the
  shared-component-styles token migration.
- **Full-page reload on sign-in.** The widget's document navigation reboots
  the SPA with the cookie present. Accepted; an `onFlowComplete` +
  `router.navigate` in-SPA handoff is possible later.
- **Identity project vs protected project.** The login flow runs against the
  reserved platform project discovered through `runtime.json` (with
  `VITE_CONSOLE_PROJECT_ID` only as a local-dev override). Data calls may
  target any customer project the signed-in principal is authorized to use;
  Console ADR 0004 and root ADR 052 keep those scopes distinct.
- **Fail-closed session probe.** Any `fetchSession` failure (including a
  backend outage) reads as "not signed in" and lands on the login screen,
  where the outage surfaces as a widget error.

## Consequences

- The console has a real sign-in, with deep links preserved through the
  guard, and zero bespoke auth transport — widget, cookie, and generated
  client only.
- `AppShell` moves from `__root` to `_authed`; screens keep their URLs
  (pathless layout) and their loaders/boundaries (ADR 0001) untouched.
- The secret's remaining use is server-side (dev proxy env); the browser
  bundle still never contains it (ADR 005 holds).
- **~~Dependency to track~~ resolved 2026-08-12 by withdrawal (ADR 0002):**
  no Go `/api` mount exists or is planned — the deployed console calls the
  API at the origin root. The deployed management surface now waits on
  session-derived target permissions (root ADRs 032/033/052) rather than on a
  secret-injecting mount.
- Tests: the `_authed` guard is covered by `src/routes/auth-guard.spec.tsx`;
  existing screen specs mock `@/auth/session` and run as signed-in.

## Related work

- [Console ADR 0001: Routing](0001-console-routing.md),
  [Console ADR 0002: API access and auth interceptors](0002-console-api-access.md).
- Root ADRs
  [005](../../../../docs/adrs/005-public-runtime-private-credentials.md),
  [014 §5](../../../../docs/adrs/014-design-tokens-and-ui-react-pairs.md),
  [016](../../../../docs/adrs/016-global-api-initializer.md),
  [032](../../../../docs/adrs/032-permission-catalogs.md)/
  [033](../../../../docs/adrs/033-internal-permission-management.md)/
  [036](../../../../docs/adrs/036-api-credential-planes.md)/
  [046](../../../../docs/adrs/046-claim-lifecycle-v2.md)/
  [052](../../../../docs/adrs/052-cross-project-principals.md),
  [037](../../../../docs/adrs/037-token-lifecycle.md).
- [`packages/sdk-react`](../../../../packages/sdk-react/README.md),
  [`packages/components/src/orchestrator/zitadel-login.ts`](../../../../packages/components/src/orchestrator/zitadel-login.ts),
  [`internal/api/session.go`](../../../../internal/api/session.go).
