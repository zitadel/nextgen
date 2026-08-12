# Console ADR 0003: Console authentication via the embedded login widget

> **Status:** Proposed
> **Date:** 2026-07-23 (revised 2026-08-12 — §4/Consequences: the ADR 0002
> `/api` shim this ADR narrowed was withdrawn, not built)
> **Scope:** `apps/console`. See
> [`apps/console/AGENTS.md`](../../AGENTS.md).
> **Context:** Follows the forward-looking slot recorded in
> [Console ADR 0002 §5](0002-console-api-access.md).

## Context

ADR 0002 shipped the console with **no console-user authentication**: the
browser holds no credential, and the dev-only Vite proxy injects the
project-secret bearer — explicitly labelled in
[`vite.config.mts`](../../vite.config.mts) as *"a temporary pre-login
workaround: once the console has a login, a proxy forwards the auth cookie as
the bearer and the secret is dropped."* This ADR designs that login.

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
   (same-origin, credential-less) already fits the widget's needs.
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

### 4. What the cookie does and does not authorize

**The cookie gate authenticates the console UI; it does not yet authorize
management calls.** The management plane
([`internal/api/authz.go`](../../../../internal/api/authz.go)) accepts only
project-bound bearers with management scopes; a user session carries none
until the permission model (root ADRs 032/033/036) lands. Consequences:

- The dev proxy **keeps injecting the project secret** whenever a request has
  no `Authorization` header. Cookie and bearer coexist by scheme: the
  session-cookie operations ignore the bearer, the management operations
  ignore the cookie. Signed-in-ness now gates the UI; authorization stays
  project-coarse. `POST /sessions/exchange` — the one browser-path
  operation requiring a bearer — is carried by root
  [ADR 036](../../../../docs/adrs/036-api-credential-planes.md)'s
  **publishable key** (browser-safe, origin-scoped): the runtime document
  (Console ADR 0004 §2) serves it, the login widget's handle sends it, and
  because the request then carries an `Authorization` header, the dev proxy
  never stamps the secret onto the sign-in path. The injected secret
  remains for operator-plane (management) requests only.
- ~~The production Go `/api` shim should follow the same interim shape~~
  *(Revised 2026-08-12: the shim was withdrawn — ADR 0002 §1, revised. There
  is no production proxy to attach the secret: the deployed console reaches
  the API at the origin root with the session cookie, plus the publishable
  key on the sign-in path. Management routes stay unauthorized in a deployed
  build until session-derived, permission-checked authority ships
  server-side (root ADRs 032/033); the dev proxy remains the only
  secret-injection point, and when that authority lands the secret
  disappears from it — a config change, not a console rewrite.)*

### 5. Recorded caveats

- **Dark-only widget.** The widget's surface CSS still uses the legacy
  dark-only login tokens (root ADR 014 §5), so the login screen renders the
  dark treatment in both console themes. Accepted for v1; resolves with the
  shared-component-styles token migration.
- **Full-page reload on sign-in.** The widget's document navigation reboots
  the SPA with the cookie present. Accepted; an `onFlowComplete` +
  `router.navigate` in-SPA handoff is possible later.
- **Project identity.** The login flow runs against
  `VITE_CONSOLE_PROJECT_ID` — the same project the console's data calls are
  scoped to. Local dev needs that project to have a `login` flow definition
  and at least one user (`--user-file` bootstrap).
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
  session-derived permissions (root ADRs 032/033) rather than on a
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
  [036](../../../../docs/adrs/036-api-credential-planes.md),
  [037](../../../../docs/adrs/037-token-lifecycle.md).
- [`packages/sdk-react`](../../../../packages/sdk-react/README.md),
  [`packages/components/src/orchestrator/zitadel-login.ts`](../../../../packages/components/src/orchestrator/zitadel-login.ts),
  [`internal/api/session.go`](../../../../internal/api/session.go).
