# Console ADR 0004: Deployment modes — platform cloud vs standalone self-host

> **Status:** Proposed
> **Date:** 2026-07-23 (revised same day: portal gating moved from a
> console-facing capabilities array to effective permissions)
> **Implementation state:** the standalone slice is implemented — the
> `platform.project_id` config key, single-project default resolution
> (§3: first-created project wins, no server-side creation), the
> `GET /console/runtime.json` endpoint (§2, resolved per request, always
> `mode: "standalone"` for now, including the default project's ADR 036
> **publishable key**), and the console's runtime discovery
> (`src/runtime/runtime.ts`, wired into `main.tsx`, the login screen —
> including its no-project setup hint and the publishable-key-bearing
> widget handle — and every loader's project id). The flag-gated #605 slice
> is also implemented: `platform.bootstrap_project` (default false) makes the
> server ensure the built-in platform project (`proj_platform`) exists at
> startup and resolve it as the default (no `platform.project_id` required);
> standalone default semantics are unchanged. Platform mode, the portal
> config keys, and effective-permission exposure (§4) remain future work.
> **Scope:** `apps/console` (with recorded server dependencies). See
> [`apps/console/AGENTS.md`](../../AGENTS.md).
> **Context:** Issue [#555](https://github.com/zitadel/nextgen/issues/555)
> (Console / Customer Portal epic) and
> [#527](https://github.com/zitadel/nextgen/issues/527) (Platform project
> bootstrapping).

## Context

The console will serve two very different deployments with one codebase:

- **Cloud** — Zitadel-operated, hosting many customer projects. The console
  doubles as the **customer portal**: a multi-project dashboard, billing
  (Stripe, subscription tiers), and support-access surfaces (#555).
- **Self-host** — an operator running their own server for, typically, a
  single project. No billing, no multi-project dashboard — unless #555's
  license-key mechanics later enable portal surfaces on a self-hosted
  deployment too.

Facts that constrain the design:

1. **One build artifact serves both.** The console is built once and embedded
   into the Go server (`internal/staticui/console`). Which deployment it is
   running in is a *deployment* property, not a *build* property — the same
   reasoning that made ADR 0001 derive `basepath` from the Vite base instead
   of hardcoding it. A `VITE_*` build-time mode flag is therefore the wrong
   tool.
2. **The initial self-hosted Console operates within one default project
   context.** The platform design
   ([`docs/design/platform/project-team-modeling.md`](../../../../docs/design/platform/project-team-modeling.md))
   sketches a reserved platform project for every deployment; this ADR
   **narrows that reservation to platform (cloud) mode**, where ownership,
   claim, and billing need somewhere to live. The initial standalone
   experience opens the customer's own application project — the one their
   integration (`zitadel setup` → `POST /projects`) created. Multi-project
   navigation and management are outside the initial scope, but the deployment
   model should allow them to be added later. An extra, empty bootstrap project
   alongside it would mean the console signs into a project holding none of
   the deployment's real users.
3. **The server creates no project — and keeps it that way.** `POST
   /projects` (unauthenticated, per the create-first model) is the only real
   provisioning path — the CLI's `zitadel setup` drives it, seeding the
   default user schema and login flow definitions when `seedDefaults` is on
   (`internal/service/project.go`). The console's `.env.local`
   (`VITE_CONSOLE_PROJECT_ID`, `CONSOLE_PROJECT_SECRET`) holds hand-minted
   values from such a call. (`--user-file` bootstrap inserts a bare project
   *row* to satisfy FKs — `internal/bootstrap/users/ensure.go` — but that is
   not a provisioned project: no keys, no schemas, no flows.) The one explicit
   opt-in exception is platform-mode provisioning (#605): setting
   `platform.bootstrap_project` (off by default) makes the server idempotently
   ensure the built-in platform project (`proj_platform`, a server-owned id)
   exists at startup — deliberate and configured, never silent. #527's platform-project provisioning question
   remains open **for platform mode**; standalone answers it with "don't
   provision — resolve".
4. **Permissions are the authoritative gate.** The permission catalogs
   (root ADRs [032](../../../../docs/adrs/032-permission-catalogs.md)/
   [033](../../../../docs/adrs/033-internal-permission-management.md)) are the
   model that ultimately decides what a signed-in user may do — including on
   portal surfaces: in cloud, a team member without the billing role must not
   see billing any more than a self-host user whose deployment has none.
5. **#555's product decisions:** the portal stays open-source inside the
   console; portal features activate only when explicitly enabled via
   configuration; license-key mechanics should be evaluated for self-hosted
   portals.

## Decision

Two distinct questions govern a portal surface, and the design answers each
exactly once:

- **"Does this deployment offer the feature at all?"** — server
  configuration/license. Exists before any session; distinguishes cloud from
  self-host.
- **"May this signed-in user use it?"** — a permission from the catalogs.

The console never evaluates the first question per surface. The server folds
it into the second: **effective permissions = the user's granted permissions
∩ what the deployment offers.** One vocabulary, one source of truth; the
console renders from the effective set alone.

### 1. The server owns the deployment profile

The deployment profile is server configuration (names indicative; the config
schema is the server change's to finalize):

```yaml
platform:
  project_id: ""            # the reserved platform project (see §3)
  portal:
    enabled: false          # cloud sets true; self-host may unlock via license
    billing: "none"         # "stripe" in cloud
    support_access: false
```

These keys are read only by the server. They surface to the console
exclusively through the mechanisms below — never as a build-time flag and
never as a parallel console-facing feature array.

### 2. Pre-session discovery: a minimal runtime-metadata endpoint

Some facts are needed *before* a session exists — above all, which project
the login widget (Console ADR 0003) signs into. A new unauthenticated,
same-origin endpoint carries exactly those and nothing more:

```
GET /console/runtime.json

{
  "mode": "platform" | "standalone",
  "console_project_id": "proj_…"   // omitted while the deployment has no project
}
```

Implemented in `cmd/server/console_runtime.go`, mounted by `buildHTTPMux`
next to the static UI handlers — deliberately outside the OpenAPI product
surface, because it is a console-internal contract (like the embedded SPA
mounts themselves), not part of the public API. The document is **resolved
per request** (`no-store`) from the deployment's current state (§3), so the
first `zitadel setup` changes the answer without a server restart.

- Everything in it is public runtime metadata in the ADR 005 sense — ids,
  one enum, and root ADR 036's **publishable key** (origin-scoped,
  browser-safe by construction), for which this document is the embedded
  console's carrier — the console-side analogue of the committed
  `zitadel.json` a customer app reads it from. The key is not a secret: it
  passes ADR 036's litmus test ("if this leaked into a browser bundle,
  nothing is lost") — it is the default project's preview credential
  (`project.read` only; no management operation accepts it). Never a
  project secret, license key, or feature inventory. *Implemented:*
  `publishable_key` is served alongside the project id, derived per request
  from the default project's token encryption key, and the login widget sends it as the
  public-plane bearer — most importantly on the handoff exchange, removing
  the dev proxy's secret from the sign-in path.
- The console fetches it once in the **root route's `beforeLoad`** (it must
  resolve before the `_authed` guard picks a sign-in project) and places it
  in router context; a fetch failure falls back to `mode: "standalone"` so a
  broken endpoint degrades to the smallest surface, never to an accidental
  portal.
- This answers #527's "configuration-based ID distribution vs runtime
  discovery" question with **both, layered**: operators configure the server;
  the *console* always discovers at runtime. The build artifact stays
  deployment-agnostic and the dev `.env.local` id-copying papercut
  disappears.

Alternatives rejected:

- **Build-time `VITE_CONSOLE_MODE`** — violates fact 1; would force separate
  embedded builds per deployment.
- **Injecting metadata into `index.html`** via the static handler — saves one
  round trip (viable later as an optimization; `index.html` is already
  `no-store`) but couples `internal/staticui` to live config today for no
  functional gain.
- **A console-facing `capabilities` array in this document** — the first
  draft of this ADR had one. Dropped: portal surfaces render post-login, so
  per-surface gating can (and should) ride the permission model instead of a
  second, pre-session vocabulary that the permission set would then have to
  agree with. See §4.

### 3. Standalone: the first-created project is the initial default

The initial standalone Console manages one default project, and the server
never creates it. The project the customer's integration bootstrapped —
`zitadel setup`'s `POST /projects`, the first project in the deployment —
**becomes the initial default**: the project the runtime document names, the
console signs into, and the console manages. The Console initially operates on
one project at a time; project switching and multi-project management can be
added later without requiring a separate Console deployment for each project.

Implemented (`ProjectService.DefaultProject`,
`internal/service/project.go`):

- `platform.project_id` / `NEXTGEN_PLATFORM_PROJECT_ID` set → that project
  is the default; it must exist (a missing configured project is a startup
  error, never a create).
- Unset (the default) → the deployment's **first-created project**
  (`created_at` ascending, deterministic across replicas). Resolved per
  `runtime.json` request, so the moment `zitadel setup` creates the first
  project, a console refresh picks it up — no server restart, no cached
  state.
- No project yet → the runtime document carries no `console_project_id`
  and the console's login screen renders a "run `zitadel setup`" hint
  instead of the widget.

An earlier draft of this section bootstrapped a reserved `proj_platform`
at startup. Dropped: it left every self-host deployment with *two* projects
— an empty one the console signed into and the real one holding the
customer's users. Startup provisioning of a dedicated platform project
returns as a **platform-mode** concern (#527), where the platform project
hosts customer registration and ownership rather than the deployment's app
users.

### 4. Portal surfaces render from **effective permissions**

The server exposes the signed-in user's effective permission set (the
natural carrier is the session read the console already performs at guard
time — `GET /sessions/me` growing a `permissions` claim, or a sibling
`GET /users/me/permissions`; the concrete surface belongs to the ADR 033
implementation). *Effective* means the server has already intersected the
user's grants with the deployment profile: a deployment without billing
yields no `billing.*` permission for anyone, licensed or cloud deployments
yield them only for users whose roles grant them.

Console mechanics (ADR 0001's `staticData` pattern, one field):

```ts
export const Route = createFileRoute("/_authed/billing/")({
  staticData: {
    nav: { label: "Billing", order: 8, icon: CreditCard },
    permission: "billing.read", // catalog scope name, not a console-invented term
  },
  …
});
```

- The sidebar builder (`use-nav-items`) and a `beforeLoad` check on gated
  routes filter by the session's effective set: absent permission → no nav
  entry, and a direct URL hit renders the not-found boundary. "Not offered
  by this deployment" and "not granted to you" are deliberately
  indistinguishable — the same anti-oracle stance the management API takes
  (`internal/api/authz.go`). If the product later wants upsell surfaces
  ("billing is available on cloud"), *that* — and only that — would justify
  reintroducing a deployment-facts signal; it is recorded as an open
  question, not designed here.
- `mode` itself is used for exactly two things: **which project the console
  signs into** (§5) and copy/branding nuances. No surface is gated on
  `mode`.
- #555's license-key case — a self-hosted deployment unlocking portal
  surfaces — is a server-side config/license change that widens effective
  permission sets. **Zero console changes**, same as the first draft, but
  now through the permission path.

**Bridge until ADR 033 ships:** there are no per-user grants yet, so the
server's effective set starts as *the deployment-level set for every
authenticated user* (billing/multi-project/support switched purely by
config). The console code is written against effective permissions from day
one; per-user narrowing arrives entirely server-side when the catalogs land.

### 5. Sign-in target per mode

ADR 0003's guard signs into one project. This ADR defines which:

`console_project_id` is deliberately the document's only sign-in project id —
the Console initially operates on one project at a time, and what that project
*is* follows from the mode:

- **`standalone`** — the deployment's default Console project (§3 —
  first-created, or the configured pin). `VITE_CONSOLE_PROJECT_ID` becomes
  a dev-only override and is eventually retired in favor of the runtime
  document.
- **`platform`** — the reserved platform project: customers register/log in
  on it (#527's hosted registration) and manage the customer projects their
  teams own from the multi-project dashboard. Those customer-project ids are
  API data scoped by the session, not deployment metadata — they never
  belong in this document. Inspecting a child project rides on the
  cross-project authorization model (#419/#333) and is **out of scope
  here**, as is the claim flow (#96).

### 6. UI gating is not authorization

Same caveat as ADR 0003 §4, one level up — but sharpened by this revision:
because the console gates on the *same* catalog scopes the API enforces,
hiding and enforcement can no longer drift apart vocabulary-wise. The
console's filter is still only a rendering courtesy; every portal API
enforces the permission (and the deployment profile behind it) server-side.
The runtime document and the effective-permission set are *rendering*
contracts, never a security boundary.

## Consequences

- One console artifact serves cloud, self-host, and licensed self-host;
  deployments differ only in server config — and per-user visibility differs
  only in grants. Both funnel through one mechanism the console reads:
  effective permissions.
- The console gains a small `runtime` module (pre-session doc fetch +
  context) and a `permission` field on route `staticData`; billing /
  multi-project / support screens then land as ordinary gated routes under
  `_authed` (#555 sub-issues). No console-side feature flags.
- Self-host starts with a single-project Console experience: the Console
  manages the same project the customer's app authenticates against — no
  orphan bootstrap project. The deployment model leaves room for project
  switching and multi-project management later. Before the first
  `zitadel setup`, the Console shows a setup hint instead of a login widget.
- **Dependencies to track (server-owned):** platform-mode provisioning of a
  dedicated platform project (#527, future) and the effective-permission
  exposure on the session surface (§4, an ADR 033 implementation concern).
  Until the latter lands, the console behaves as `standalone` with no
  portal permissions.
- Open questions deferred: license-key format/verification (#555), Stripe
  integration home, per-environment platform projects (#527 × ADR 035
  environments), cross-project support access UX (#419/#333), and whether
  upsell surfaces ever warrant exposing "offered here but not granted to
  you" (deliberately not exposed today, §4).

## Related work

- Issues [#555](https://github.com/zitadel/nextgen/issues/555),
  [#527](https://github.com/zitadel/nextgen/issues/527),
  [#96](https://github.com/zitadel/nextgen/issues/96),
  [#419](https://github.com/zitadel/nextgen/issues/419) /
  [#333](https://github.com/zitadel/nextgen/issues/333).
- [Console ADR 0001](0001-console-routing.md) (staticData/nav, derived
  basepath), [0002](0002-console-api-access.md), [0003](0003-console-authentication.md).
- Root ADRs [005](../../../../docs/adrs/005-public-runtime-private-credentials.md),
  [032](../../../../docs/adrs/032-permission-catalogs.md) /
  [033](../../../../docs/adrs/033-internal-permission-management.md),
  [035](../../../../docs/adrs/035-configuration-environments.md),
  [024](../../../../docs/adrs/024-user-team-lifecycle-ownership.md).
- [`docs/design/platform/project-team-modeling.md`](../../../../docs/design/platform/project-team-modeling.md)
  (the reserved platform project), `internal/service/project.go`
  (`seedDefaults`), `internal/bootstrap/users/ensure.go`,
  `internal/api/authz.go` (anti-oracle answers).
