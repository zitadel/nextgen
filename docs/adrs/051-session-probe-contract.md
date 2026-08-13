# ADR 051: Anonymous Session-Probe Contract

> **Status:** Proposed
> **Date:** 2026-08-12 (revised three times same day after review: the
> platform already has valid anonymous sessions, including factor-verified
> ones with no bound user; the discriminator keys only on that binding while
> preserving today's omitted `user_id`, and the plan pins an exercising
> browser fixture plus the SQLite harness bootstrap)
> **Context:** `GET /sessions/me`, `@zitadel/sdk-*` session reads, `<zitadel-session>`, header chrome

## Problem

`GET /sessions/me` is the session read every surface uses to answer "is
someone signed in, and who": the `<zitadel-session>` card, `getSession()`
in the SDKs, scaffolded header chrome, and `auth()` on the server side.

The platform distinguishes three visitor states today, but the endpoint
can only express two of them:

1. **No session** — no `__nextgen_session` cookie at all. The request
   dies at the security layer with `401 auth.unauthorized`.
2. **Valid session without a resolved user** — `200` with the full
   session body and no `user_id` property in current server output:
   `sessionToAPI` leaves the generated optional value unset, and the
   encoder omits it. The OpenAPI property is optional and nullable, so
   clients must treat omission and explicit `null` equivalently. Two
   shapes produce it: the pure shell `POST /sessions` mints (no user, no
   factors; pre-auth correlation, bot-detection and device signals,
   10-minute TTL), and a mid-flow session holding verified factors but no
   bound user — a password-only exchange promotes the factor without
   resolving a user, and its computed lifecycle state is `active`, not
   `building` (`sessionStateFilter` in `internal/service/session.go`;
   exercised in `internal/storage/stmttest/session_test.go`).
   `getSession()` already reads both session shapes as signed out.
3. **Authenticated session** — `200` with the session body and its user.

State 1 is the wrong-shaped one, twice over:

- **"Who am I" has an honest answer for cookieless visitors** — "nobody".
  Absent credentials are not an error condition for a probe whose entire
  purpose is distinguishing signed-in from signed-out.
- **Every cookieless page view logs a red 4xx in the browser console** —
  and cookieless is the *most common* state for a public page embedding
  session-aware chrome. The first thing an integrator sees in devtools is
  our SDK apparently failing.

What must NOT change:

- An **invalid** credential (garbage or tampered cookie) stays `401` —
  invalid must remain loud, and the session-fixation guards in the
  auth-attempt domain depend on the distinction.
- A cookie referencing a session that no longer exists keeps its existing
  `404 sess.not_found` answer.
- The **anonymous session state keeps its full body** — its `session_id`,
  `state`, `factors`, and `expires_at` are load-bearing for pre-auth
  correlation; a probe redesign that discards or mislabels them breaks
  the session-shell feature, not just the chrome.

## Options

### A. Discriminated 200 on `GET /sessions/me` (recommended)

Add a `session_state` discriminator across three `200` variants. The
mapping is exhaustive and keys only on whether the resolved session has a
bound user — never on factors or the computed lifecycle state:

- `{ "session_state": "none" }` — no credential presented; no session
  body (there is no session to describe). **New.**
- `{ "session_state": "anonymous", ...session }` — any resolved session
  with no bound user: the `building` shell and the `active` password-only
  session alike. Its `user_id` remains optional and nullable; current
  server output omits it, while clients also accept explicit `null`.
  Today's full body is otherwise unchanged apart from the discriminator.
- `{ "session_state": "authenticated", ...session }` — any resolved
  session with a bound user; this variant requires a non-null `user_id`.
  Today's authenticated body is unchanged apart from the discriminator.

`401` narrows to invalid credentials; `404 sess.not_found` is untouched.

- Honest resource semantics; one endpoint keeps being *the* session read,
  and the session-shell state is named instead of inferred by
  inspecting the optional `user_id`.
- The SDK read contract barely moves: `none` and `anonymous` both read as
  signed out (`getSession()` already treats a 200 without a user that
  way); advanced callers keep the shell's fields.
- Cost: response-schema union across the OpenAPI spec, ogen server, orval
  client/zod, console, and components; every consumer of "200 ⇒ session
  body" must be audited for the body-less `none` variant. Alpha is the
  window where this is cheap.
- Minimal sub-option (A′): add only the body-less `none` variant and keep
  optional `user_id` presence/value as the anonymous signal. Smaller
  diff, but typed clients keep inspecting that property and the three
  states stay implicit;
  regeneration happens either way, so the discriminator is recommended.

### B. Status envelope on `GET /sessions/me`

`200 { "authenticated": bool, "session": {...}? }` — wrap rather than
discriminate. Same blast radius as A plus a wrapper migration for every
existing consumer (today's clients read session fields at the top level),
and the anonymous-session state still needs a third signal inside the
wrapper. Strictly dominated by A.

### C. Separate optional-auth probe endpoint

Add `GET /sessions/me/state` (public plane, optional auth) returning
`{ "authenticated": bool, "user_id"?, "name"?, "email"? }`; chrome and
`getSession()` migrate to it; `/sessions/me` keeps its current contract.

- Zero migration for existing `/sessions/me` consumers; smallest diff.
- Cost: two endpoints describing one resource, drifting independently;
  the wrong-shaped 401 wart survives on `/sessions/me`; the probe shape
  shown collapses the anonymous-session state all over again, and fixing
  that turns it into A behind a second URL. A permanent second endpoint
  to dodge a one-time alpha migration is the wrong trade.

## Decision (proposed)

Option A. Sequence:

1. Spec: `GET /sessions/me` 200 becomes the `session_state`-discriminated
   union above. The anonymous variant keeps `user_id` optional and
   nullable (preserving the server's current omission); the authenticated
   variant requires it and excludes `null`. `401` narrows to
   invalid-credential; `404` is unchanged. `Cache-Control: no-store` on
   every variant.
2. Server: the security layer treats an absent credential on this
   operation as the `none` state instead of rejecting; valid session
   tokens resolve exactly as today, with the handler stamping
   `anonymous`/`authenticated` from the resolved domain session's user
   binding before serialization. Invalid tokens keep the existing
   rejection path.
3. Clients: regenerate; audit every consumer of the 200 for the
   discriminator and the body-less `none` variant (components
   `getSession`, sdk-core/session helpers, console session views,
   integration harness).
4. Mock parity: `packages/api-mock`'s `GET /sessions/me` (today: `401`
   without a cookie, undiscriminated body with one) implements the same
   three-variant contract, with direct conformance specs in the mock's
   own suite. This layer is load-bearing, not a courtesy: both framework
   demo journeys run against the mock while their e2e tasks are excluded
   from CI, so without it the Go contract tests could pass while the
   exact public-page chrome path motivating this ADR stays broken.
5. A representative browser journey (framework demo e2e against the
   mock) adds public-page client chrome that actually calls browser-side
   `getSession()` through the framework proxy. The journey asserts the
   cookieless `GET /sessions/me` occurred and returned `200 none`, then
   asserts signed-out chrome and zero console errors. A render-only check
   does not count: today's demo home pages already render signed-out
   without issuing the probe. Run this journey at least on demand until
   those lanes join CI; the mock conformance specs above are the always-on
   gate.
6. Contract tests, service-backed on **all three dialects** — PostgreSQL,
   Spanner, and SQLite (the zero-config default with its own CI lane). The
   session-me integration suite currently builds only for the first two,
   so this work adds `sqlite_integration` to both the suite and its shared
   harness, plus a SQLite `TestMain` that initializes `harness.DB` through
   `dbtest.SQLite`; adding the tag only to `session_me_test.go` does not
   compile. The matrix is:
   absent cookie → `200 none`; valid shell cookie → `200 anonymous` with
   the full body and `user_id` omitted (with schema conformance also
   accepting explicit `null`); password-only exchange cookie (verified
   factors, no bound user) → `200 anonymous` with factors intact and
   `user_id` omitted; authenticated cookie → `200 authenticated` with a
   required non-null `user_id`; garbage, tampered, expired, and revoked
   tokens → `401`; a cookie referencing a pruned session → `404
   sess.not_found`.

## Consequences

- Cookieless visitors produce zero console noise; header chrome reads a
  clean 200 in all three states.
- The anonymous session shell keeps its contract — nothing about its
  body, omitted `user_id`, TTL semantics, or pre-auth correlation changes;
  it gains an explicit name on the wire.
- One breaking-in-shape change inside the alpha train, loudly
  changelogged; SDKs from the same train handle all three states, so
  lockstep consumers are unaffected.
