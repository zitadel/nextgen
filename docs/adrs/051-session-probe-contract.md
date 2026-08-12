# ADR 051: Anonymous Session-Probe Contract

> **Status:** Proposed
> **Date:** 2026-08-12
> **Context:** `GET /sessions/me`, `@zitadel/sdk-*` session reads, `<zitadel-session>`, header chrome

## Problem

`GET /sessions/me` is the session read every surface uses to answer "is
someone signed in, and who": the `<zitadel-session>` card, `getSession()`
in the SDKs, scaffolded header chrome, and `auth()` on the server side.

For a visitor without a session cookie, the request dies at the security
layer with `401 auth.unauthorized`. That is wrong-shaped twice:

1. **"Who am I" has an honest answer for anonymous visitors** — "nobody".
   Absent credentials are not an error condition for a probe whose entire
   purpose is distinguishing signed-in from signed-out.
2. **Every signed-out page view logs a red 4xx in the browser console.**
   Fetch failures are developer-visible noise on every page that renders
   session-aware chrome — the first thing an integrator sees in devtools
   is our SDK "failing".

The client contracts already anticipate the fix without shipping it: the
`getSession()` documentation promises that "200 for an anonymous session"
reads as signed out — but no such response exists. The 200 schema
(`session-response.yaml`) requires a full session object (`session_id`,
`project_id`, `state`, `factors`, …) and has no anonymous shape.

What must NOT change: an **invalid** credential (garbage or expired
cookie) stays `401` — invalid must remain loud, and the session-fixation
guards in the auth-attempt domain depend on that distinction.

## Options

### A. Discriminated 200 on `GET /sessions/me` (recommended)

Absent credential → `200 { "session_state": "anonymous" }`. Present,
valid credential → `200 { "session_state": "authenticated", ...session }`.
Invalid credential → `401` unchanged.

- Honest resource semantics; one endpoint keeps being *the* session read.
- The SDK contract already tolerates it (documented, verify-not-trust
  reads key on identity fields, not mere 200).
- Cost: response-schema union across the OpenAPI spec, ogen server, orval
  client/zod, console, and components; every strict consumer of "200 ⇒
  full session object" must be found and taught the discriminator. Alpha
  is the window where this is cheap; it only gets more expensive.

### B. Status envelope on `GET /sessions/me`

`200 { "authenticated": bool, "session": {...}? }` — wrap rather than
discriminate. Same blast radius as A plus a wrapper migration for the
authenticated path (today's consumers read session fields at the top
level), for no additional expressiveness. Strictly dominated by A.

### C. Separate optional-auth probe endpoint

Add `GET /sessions/me/state` (public plane, optional auth) returning
`{ "authenticated": bool, "user_id"?, "name"?, "email"? }`; chrome and
`getSession()` migrate to it; `/sessions/me` keeps its current contract.

- Zero migration for existing `/sessions/me` consumers; smallest diff.
- Cost: two endpoints describing one resource, drifting independently;
  the wrong-shaped 401 wart survives on `/sessions/me`; the session card
  would still hit `/sessions/me` for its richer read (or migrate too,
  recreating A's migration anyway). A permanent second endpoint to dodge
  a one-time alpha migration is the wrong trade.

## Decision (proposed)

Option A. Sequence:

1. Spec: `GET /sessions/me` 200 becomes a `session_state`-discriminated
   union (`authenticated` carries today's session body at the top level;
   `anonymous` carries nothing else). `401` narrows to invalid-credential
   only. `Cache-Control: no-store` on both variants.
2. Server: the security layer treats absent credentials on this operation
   as anonymous instead of rejecting; the handler returns the anonymous
   variant. Invalid tokens keep the existing rejection path.
3. Clients: regenerate; audit every consumer of the 200 for the
   discriminator (components `getSession`, sdk-core/session helpers,
   console session views, integration harness).
4. Contract tests: no-cookie → 200 anonymous; garbage cookie → 401;
   valid cookie → 200 authenticated (service-backed, both dialects).

## Consequences

- Signed-out visitors produce zero console noise; header chrome reads a
  clean 200 either way.
- `getSession()`'s documented contract becomes true instead of aspirational.
- One breaking-in-shape change inside the alpha train, loudly changelogged;
  SDKs from the same train handle both shapes, so lockstep consumers are
  unaffected.
