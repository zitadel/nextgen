# ADR 051: Anonymous Session-Probe Contract

> **Status:** Proposed
> **Date:** 2026-08-12 (revised same day after review: the platform already
> has valid anonymous sessions — the contract must carry three states, not
> two)
> **Context:** `GET /sessions/me`, `@zitadel/sdk-*` session reads, `<zitadel-session>`, header chrome

## Problem

`GET /sessions/me` is the session read every surface uses to answer "is
someone signed in, and who": the `<zitadel-session>` card, `getSession()`
in the SDKs, scaffolded header chrome, and `auth()` on the server side.

The platform distinguishes three visitor states today, but the endpoint
can only express two of them:

1. **No session** — no `__nextgen_session` cookie at all. The request
   dies at the security layer with `401 auth.unauthorized`.
2. **Valid anonymous session** — `POST /sessions` mints a session shell
   with no user and no factors (pre-auth correlation, bot-detection and
   device signals, 10-minute TTL); its cookie authorises `/sessions/me`,
   which returns `200` with the full session body and `user_id: null`.
   `getSession()` already reads this correctly as signed out.
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

Add a `session_state` discriminator across three `200` variants:

- `{ "session_state": "none" }` — absent credential; no session body
  (there is no session to describe). **New.**
- `{ "session_state": "anonymous", ...session }` — valid session shell;
  today's full body with `user_id: null`, unchanged apart from the
  discriminator.
- `{ "session_state": "authenticated", ...session }` — today's
  authenticated body, unchanged apart from the discriminator.

`401` narrows to invalid credentials; `404 sess.not_found` is untouched.

- Honest resource semantics; one endpoint keeps being *the* session read,
  and the session-shell state is named instead of inferred by
  null-sniffing `user_id`.
- The SDK read contract barely moves: `none` and `anonymous` both read as
  signed out (`getSession()` already treats the null-user 200 that way);
  advanced callers keep the shell's fields.
- Cost: response-schema union across the OpenAPI spec, ogen server, orval
  client/zod, console, and components; every consumer of "200 ⇒ session
  body" must be audited for the body-less `none` variant. Alpha is the
  window where this is cheap.
- Minimal sub-option (A′): add only the body-less `none` variant and keep
  `user_id` nullness as the anonymous signal. Smaller diff, but typed
  clients keep null-sniffing and the three states stay implicit;
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
   union above; `401` narrows to invalid-credential; `404` unchanged.
   `Cache-Control: no-store` on every variant.
2. Server: the security layer treats an absent credential on this
   operation as the `none` state instead of rejecting; valid session
   tokens resolve exactly as today, with the handler stamping
   `anonymous`/`authenticated` from the resolved session. Invalid tokens
   keep the existing rejection path.
3. Clients: regenerate; audit every consumer of the 200 for the
   discriminator and the body-less `none` variant (components
   `getSession`, sdk-core/session helpers, console session views,
   integration harness).
4. Contract tests (service-backed, both dialects): absent cookie → `200
   none`; valid anonymous-shell cookie → `200 anonymous` with the full
   body and `user_id: null`; authenticated cookie → `200 authenticated`;
   garbage, tampered, expired, and revoked tokens → `401`; a cookie
   referencing a pruned session → `404 sess.not_found`.

## Consequences

- Cookieless visitors produce zero console noise; header chrome reads a
  clean 200 in all three states.
- The anonymous session shell keeps its contract — nothing about its
  body, TTL semantics, or pre-auth correlation changes; it gains an
  explicit name on the wire.
- One breaking-in-shape change inside the alpha train, loudly
  changelogged; SDKs from the same train handle all three states, so
  lockstep consumers are unaffected.
