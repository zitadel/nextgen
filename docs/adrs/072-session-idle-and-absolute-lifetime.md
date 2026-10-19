# ADR 072: Session Lifetime — an Idle Timeout Within an Absolute Lifetime

> **Status:** Proposed
> **Date:** 2026-10-19
> **Context:** An outside-developer DX test of the preview found every
> signed-in session ending 10 minutes after sign-in, because
> `session.default_ttl` defaulted to the lifetime of an anonymous shell.
> [PR #2060](https://github.com/zitadel/nextgen/pull/2060) gives signed-in
> sessions a 24-hour default of their own and keeps that lifetime absolute,
> because no ADR or design note describes renewal. This ADR decides what
> follows.
>
> **Builds on:** [ADR 010](010-session-auth-attempt-check-model.md) (sessions,
> attempts and checks), [ADR 037](037-token-lifecycle.md) (opaque,
> server-authoritative session tokens; revocation deletes the record),
> [ADR 051](051-session-probe-contract.md) (`GET /sessions/me`),
> [ADR 053](053-cross-project-principals.md) §5 (the CSRF token),
> [ADR 067](067-benchmark-harness-http-path-ownership.md) (the benchmark
> harness), [ADR 068](068-project-is-the-data-boundary.md) and
> [ADR 069](069-variables-per-kind-frozen-per-deployment.md) (sessions are
> project data; values are frozen per deployment), and the settings proposal
> of [PR #1347](https://github.com/zitadel/nextgen/pull/1347)

## Context

### How a session's lifetime works today

The exchange that ends a sign-in decides the lifetime, once:

- `POST /sessions/exchange` resolves it with `domain.ResolveSessionTTL`: the
  request's `ttl` when it has one, at most `session.max_ttl` (720h), otherwise
  `session.default_ttl` (24h with #2060). No SDK sends `ttl`. An anonymous
  shell from `POST /sessions` gets a fixed 10 minutes.
- The session row stores the lifetime as `time_to_live` and derives
  `expires_at` as `updated_at + time_to_live`: a trigger on PostgreSQL, a
  stored generated column on Spanner and SQLite. Only the exchange writes
  `updated_at` (`UpdateSessionAfterExchange`), and that alone is what keeps the
  lifetime absolute.
- `CreateSessionToken` (`internal/storage/dialect/*/session.go`) copies
  `session.ExpiresAt` into the token record. `IntrospectToken`
  (`internal/service/token.go`) refuses a token whose record has expired, and
  it is the gate of every request the `__nextgen_session` cookie authenticates
  (`HandleNextgenSession`). `GET` and `DELETE /sessions/me` and
  `GET /sessions/me/csrf` also read the session row: the cookie must name the
  session's current token, and `expires_at` must lie ahead
  (`validateSessionToken`).
- The token's JWE carries the same expiry as a claim. `IntrospectToken` does
  not check it, but `GET` and `PATCH /users/me` do (`validSessionToken` in
  `internal/service/user.go`), so the claim is a third copy of the deadline
  that a renewal has to account for.
- `setSessionCookie` (`internal/api/session.go`) sets the cookie's `Max-Age`
  from `session.ExpiresAt` when the token is minted. Nothing sets it again.
- The CSRF token is an HMAC keyed by the cookie's value (`CSRFToken`,
  ADR 053 §5): a new cookie value invalidates every CSRF token a console tab
  holds.
- A step-up is an exchange on an existing session. It writes `updated_at`, so
  the session lives `time_to_live` from the step-up, and it mints a new token
  and deletes the old one. `max_ttl` bounds what one exchange may ask for, not
  how old a session can grow through re-authentication.

The reads a renewal would ride on:

- The middlewares of sdk-next, sdk-nuxt, sdk-qwik-city, sdk-solid-start,
  sdk-sveltekit and sdk-tanstack-start call `GET /sessions/me` server to
  server on every request their matcher covers. A session token is a JWE,
  whose header names an `enc`, so `isJwtShaped` rejects it and this path
  always runs. They read the body and drop the headers: a `Set-Cookie` on that
  answer never reaches the browser. Their `/__nextgen` proxies do forward `Set-Cookie`
  (`getSetCookie()`).
- The console's `_authed` guard calls `GET /sessions/me` on each navigation,
  behind a 15-second cache (`apps/console/src/auth/session.ts`).
- When the probe fails, the middlewares delete every `__nextgen*` cookie: on a
  401, but also on a 5xx, a timeout or a network error, which is broader than
  the rule `internal/AGENTS.md` ("Errors") states for the server.
- Neither the SDKs nor the console probe the session on a timer. A tab left
  open sends nothing.

### What is missing

A session ends 24 hours after sign-in however much it is used, and a session
nobody uses also lives the full 24 hours. Whether active users should stay
signed in by use, and whether unused sessions should end sooner, is a product
and a security decision.

NIST SP 800-63B-4 §5.2 has both clocks. An overall timeout limits a session to
a period after authentication or reauthentication, and an inactivity timeout
ends a session that sees no activity. Activity resets the inactivity timeout,
and a successful reauthentication resets both. Every AAL must have an overall
timeout: no more than 30 days at AAL1 and 24 hours at AAL2 (recommended), and
12 hours at AAL3 (required). The inactivity timeout is optional at AAL1 and
recommended at no more than 1 hour at AAL2 and 15 minutes at AAL3. §5.1 asks
that a session cookie expire at or soon after the session's validity period,
and that the cookie's expiry never be what enforces a timeout.

OWASP ASVS 5.0 asks for an inactivity timeout and an absolute maximum session
lifetime (7.3.1 and 7.3.2, level 2), and for a new session token on
authentication and re-authentication (7.2.4, level 1), which the exchange
already mints.

## Decision (proposed)

### 1. Model: an idle timeout inside an absolute lifetime

|                                | Absolute only (today)    | Idle only                                 | Both (recommended)             |
|--------------------------------|--------------------------|-------------------------------------------|--------------------------------|
| A user who keeps using the app | signed out mid-use       | never signed out                          | signed out at the absolute end |
| A session nobody uses          | lives its whole lifetime | ends after the idle timeout               | ends after the idle timeout    |
| A stolen cookie in use         | ends at the deadline     | never ends                                | ends at the absolute end       |
| NIST SP 800-63B-4              | overall timeout only     | no overall timeout, which every AAL needs | both timeouts                  |
| Cost                           | none                     | writes on use                             | writes on use                  |

A signed-in session has two clocks:

- The **absolute lifetime** runs from the authentication that started the
  session, whatever happens after it. `session.default_ttl` and the exchange's
  `ttl` keep setting it, and `session.max_ttl` keeps bounding it. Use never
  extends it.
- The **idle timeout** is how long the session survives unused. Each use moves
  the idle deadline to the time of use plus the timeout, never past the
  absolute deadline. It is new, `session.idle_timeout`. Unset means none: the
  session lives its absolute lifetime, as it does after #2060.

`expires_at` stays the one deadline every reader checks: the earlier of the
two. A re-authentication, which is an exchange on an existing session,
restarts both clocks and mints a new token, as a step-up already does for the
lifetime today. An anonymous shell keeps its fixed 10 minutes; completing a
sign-in, not use, is what renews it.

Idle only is out: NIST asks for an overall timeout at every AAL, and a stolen
cookie in use would never expire. Absolute only stays available as the case of
an unset idle timeout.

### 2. A renewal extends the token in place and never mints a new one

**Re-minting** on renewal, a new token record, the old one deleted and the new
value sent in `Set-Cookie`, costs four things here:

1. The `Set-Cookie` has to reach the browser, and the SSR probes drop it. Every
   middleware SDK would have to copy it onto the page response. Until it does,
   the browser keeps a cookie whose record is gone, and the next request signs
   the user out.
2. Parallel requests race it. One page load sends the middleware probe and the
   page's own proxied requests with the same cookie. The first to renew
   deletes the record the others carry, they answer 401, and the SDK deletes
   `__nextgen_session`. A cookie is keyed by its name, not its value, so a
   deletion that arrives after the new cookie removes the new one. Avoiding
   that takes a grace window for the previous token: a row that tracks two
   token ids, a `validateSessionToken` that accepts either, and something that
   removes the leftover record.
3. Every rotation invalidates the console's CSRF token, so its next
   state-changing request fails until it fetches a new one.
4. It buys little. A stolen cookie stops working only if the user renews before
   the thief does, and reuse detection cannot tell a thief from the parallel
   requests of point 2.

**Extending in place (recommended):** a renewal moves the session row's
deadline and the token record's `expires_at` together, in one statement. The
cookie value never changes, so no request in flight finds its token gone, and
the CSRF token stays valid. The exchange writes the absolute deadline, the
latest the session can be valid, into the two places a renewal cannot reach:
the token's expiry claim, which `/users/me` keeps checking, and the cookie's
`Max-Age`. A renewal then sends no `Set-Cookie`, and no SDK changes.

The token's value now lasts as long as its session. ASVS asks for a new token
on authentication and re-authentication, which the exchange keeps minting, and
NIST allows a session secret to be refreshed during a session without
requiring it. A stolen cookie is bounded by the absolute lifetime and ended by
logout or an operator's revoke, both of which delete the record (ADR 037). The
cookie is `HttpOnly`, `SameSite=Lax` and `Secure` on https, and script never
reads it (ADR 036).

A cookie can now outlive its session by up to the absolute lifetime minus the
idle timeout. This is the reading of NIST §5.1 this ADR takes: the cookie
expires at the end of the longest validity its session can have, and the
server, not the cookie, enforces both clocks. A dead cookie gets a 401 on its
next request and the SDK clears it, as it clears a revoked session's cookie
today.

### 3. Any request the cookie authenticates renews, at most once per half idle timeout

Where a renewal can happen:

- **Only in `GET /sessions/me`.** It misses API activity. A console user who
  works in one view saves through state-changing requests and rarely
  navigates; with an idle timeout of an hour, they are signed out while
  working.
- **A renewal endpoint** (`POST /sessions/me/renew`, say). It keeps every `GET`
  a read, but every SDK and the console must call it, it needs a CSRF token
  (ADR 053 §5), and the middlewares must forward its answer, all to save a
  write the throttle below already bounds.
- **Any request the cookie authenticates (recommended).**
  `HandleNextgenSession`, which every cookie-authenticated operation passes,
  renews once the request has passed its CSRF checks, so a forged request
  renews nothing. `GET /sessions/me` renews like every other operation, not as
  a special case. A session token never arrives as a bearer, since
  `HandleOAuth2` accepts only project secrets, so the cookie is the one path.

The decision uses only what introspection already read: the record's
`expires_at`, the absolute deadline in the token's expiry claim, and the idle
timeout in a new claim beside it, both fixed at the exchange (ADR 037 allows
claims that save a round trip). A request writes only when a renewal is due:

- **Due:** less than half the idle timeout is left, and the deadline is still
  before the absolute one.
- **Conditional:** the statement moves the row and the record only while
  `expires_at` still holds the value introspection read and still lies ahead.
  Racing requests write once, and a session that has expired, or that the
  reaper ([ADR 065](065-background-jobs.md), #881) is deleting, never comes
  back.
- **Best effort:** a failed renewal is logged, and the request goes on with the
  deadline it has. A renewal never changes a request's answer, and never turns
  into a 401 (`internal/AGENTS.md`, "Errors").

A session then renews at most twice per idle timeout, however many requests it
makes. Between renewals the probe stays a read, and with no idle timeout set it
never writes. The price is precision: a session renewed at time *t* is not
renewed again before *t* plus half the timeout, so it ends between half and
all of the idle timeout after its last use. The configured value is the longest
a session survives unused, which is the bound NIST's ceilings set. ASP.NET
Core's sliding cookie expiration renews on the same halfway rule.

A `GET` that may write is still safe in the sense of RFC 9110 §9.2.1: the
client asked for nothing it can be held to, and the write only postpones a
deadline the session already has. With `SameSite=Lax`, another site can get the
cookie sent only with a top-level navigation, which at worst keeps alive a
session the user already holds, within its absolute lifetime.

No client probes the session on a timer: a timed probe keeps an unattended tab
signed in and voids the idle timeout. The SDKs and the console do not today,
and this ADR makes it a rule.

The cost is measured before an idle timeout is turned on anywhere (ADR 067).
The harness has no operation for the probe yet; it runs the sign-in steps and
`getUser`. It gets a `getMySession` operation, run in two scenarios: sessions
whose renewal is never due, which is the probe as it is, and a fixture whose
idle timeout is short enough that every iteration renews, which is the worst
case. Their difference is the price of a renewal, and with the throttle, real
traffic sits close to the first.

### 4. Per project, frozen into the session at sign-in

- **Server-wide only**, as today: one value for every project on a server, the
  cloud's tenants included, and the same for the console as for every app.
- **Per sign-in**, the exchange's `ttl`: it exists for the absolute lifetime,
  for an app that wants, say, a long lifetime behind "remember me", and the
  SDKs do not expose it yet. Whether a sign-in may also ask for an idle timeout
  is left open.
- **Per project (recommended next):** the absolute lifetime and the idle
  timeout become project settings in the sense of the settings proposal
  (PR #1347): owned by the project, revisioned in its release, falling back to
  `session.default_ttl` and `session.idle_timeout`, and bounded by
  `session.max_ttl`, which stays system-only. That proposal already makes
  `session.default_ttl` a project setting bounded by `max_ttl`.

A session belongs to its project (ADR 068), but it is signed in through one
origin's release. It takes its values from that release at the exchange and
keeps them, the way a deployment keeps the variables it froze (ADR 069). A
later deployment changes later sign-ins and leaves existing sessions alone,
which is what the settings proposal asks of a promoted change. A renewal reads
the idle timeout its session froze, never the current setting, so it needs no
settings read.

Per project is also how the console gets values of its own. Its sessions
belong to the platform project, which can pick a shorter idle timeout for the
operator surface, NIST's 1 hour at AAL2 for instance, than customer apps pick
for theirs.

### 5. Freshness stays with the factors

The lifetime bounds how long a session keeps its identity at all. `x-freshness`
([session-api.md](../design/flowengine/session-api.md)) bounds how long it
carries an assurance level.

- A renewal extends the session, never a factor. `verified_at` does not move,
  so a renewed session keeps losing assurance levels on schedule, and only a
  re-authentication restores one. A renewal never writes a check.
- A ceiling per level is freshness, not lifetime. NIST's 12-hour overall
  timeout at AAL3 is an `x-freshness` of 12 hours or less on that level's
  factors, and the session can outlive it at a lower level.
- An idle timeout per level (1 hour at AAL2, 15 minutes at AAL3) cannot be
  expressed. Freshness counts from verification, not from the last use, and
  the throttle knows the last use only to within half the session's idle
  timeout. A project that needs one sets the session's idle timeout to it; a
  keyword per level is out of scope.
- Until assurance levels and step-up exist (`sessionToAPI` still serves no
  `assurance_levels`), a session's age is the only freshness a sensitive
  operation gets, the console's included. That is why §6 keeps the default
  where #2060 put it.

### 6. Defaults

| Option                                  | Absolute     | Idle | What it gives                                                                                                                      |
|-----------------------------------------|--------------|------|------------------------------------------------------------------------------------------------------------------------------------|
| **(a) #2060, recommended for now**      | 24h          | none | A sign-in a day, and an unused session lives 24h. Within NIST's overall ceilings for AAL1 and AAL2, without AAL2's idle timeout.   |
| (b) Tighter                             | 24h          | 1h   | NIST's AAL2 recommendations. Signs a user out over lunch.                                                                          |
| (c) Signed in for as long as it is used | 7 to 30 days | 24h  | Daily use keeps the session. As the server-wide default it needs step-up first, or a sign-in days old authorizes console administration. |

The server-wide default stays (a). An operator, and once §4 lands a project,
can pick (b) or (c). The default is revisited once step-up exists.

### 7. API, mock and docs

- A session's `expires_at` keeps meaning when the session ends unless it is
  used, and renewals move it. The session response gains the absolute
  deadline beside it, named in the spec change (`absolute_expires_at`, for
  example), so an app can warn before a forced sign-in, as the usability
  guidance of NIST SP 800-63B-4 suggests.
- The exchange's `ttl` keeps setting the absolute lifetime. Its OpenAPI
  description, and that of `expires_at`, change with the model.
- The docs #2060 adds say that using a session does not extend it
  (`docs/quick-start/configuration.md#sessions` and
  `apps/docs/content/docs/concepts/sessions-auth-attempts.mdx`). They change
  when renewal ships, and document `session.idle_timeout`.
- `packages/api-mock` serves the new field, since ADR 051 made the mock's
  parity load-bearing for the demo journeys. It keeps its fixed one-hour
  lifetime and does not renew.

## Recommended sequence

1. Land #2060.
2. Add `getMySession` to the benchmark harness and record the probe's
   baseline (ADR 067). This does not wait for step 3.
3. Storage: the session row records its absolute deadline, `expires_at` never
   passes it, and one renewal statement moves the row's and the token record's
   deadlines together on all three dialects, with the shared statement suite
   ([ADR 041](041-storage-statement-contract-tests.md)) asserting the same
   deadlines on each. Whether `expires_at` becomes the earlier of
   `updated_at + time_to_live` and the absolute deadline, or the renewal
   writes `updated_at` and `time_to_live` so that today's expression yields the
   capped deadline, is the implementation's call. The first changes a stored
   generated column's expression, which neither SQLite nor Spanner allows in
   place: Spanner drops and re-adds the column, SQLite rebuilds the table.
4. Service and API: the exchange, sign-in and step-up alike, sets both clocks,
   the token's expiry and idle-timeout claims and the cookie's `Max-Age`, and
   `HandleNextgenSession` renews when due. Integration tests on all three
   dialects cover the idle expiry, the absolute cap, `/users/me` after a
   renewal, a step-up restarting both clocks, parallel requests during a
   renewal (no 401), a revoke racing a renewal, and a token minted before the
   change (no idle-timeout claim, never renewed).
5. Config: `session.idle_timeout`, unset by default, validated at start-up
   beside `default_ttl` and `max_ttl`.
6. Spec, mock and docs, as in §7.
7. Measure the probe with an idle timeout set, with renewal due and not due.
8. Per-project values once the settings mechanism lands, frozen into each
   session at the exchange. The platform project picks the console's.
9. Revisit the default (§6) once assurance levels and step-up ship.

Nothing is implemented before this ADR is accepted.

## Consequences

- Nothing changes by default: a session lives 24 hours from sign-in until an
  operator sets an idle timeout or raises the lifetime.
- With an idle timeout set, the probe every page load sends writes at most
  twice per idle timeout per session. With none set, it never writes.
- A cookie outlives a session that went idle, and the SDKs clear it on its
  next 401, as they clear a revoked session's cookie.
- The session token's expiry claim carries the absolute deadline, and a new
  claim the idle timeout. A token minted before the change has no idle-timeout
  claim and is never renewed, and its expiry claim already equals its
  deadline, so an upgrade changes nothing for sessions already signed in.
- A stolen cookie in use stays valid until the absolute deadline. Rotation
  would not close that gap (§2); a shorter absolute lifetime, logout and
  revocation do.
- A renewal emits no audit event: renewals are frequent activity of little
  value to an audit, and each event would be a second write.

## Related defects, not decided here

- The middlewares clear the `__nextgen*` cookies on any failed probe, not only
  on a 401, so a 5xx, a timeout or a network error signs the user out, against
  the server-side rule in `internal/AGENTS.md`. They should clear only on a
  401.
- A step-up mints a new token, so a request in flight with the previous cookie
  gets a 401, and the clearing above can delete the cookie the step-up just
  set. It is the race of §2, rarer because a user action starts it. Clearing
  only when the cookie is still the one that failed, or a short grace window
  for the previous token, would close it.

## Alternatives considered

- **Re-minting on renewal**, with or without a grace window for the previous
  token (§2).
- **Renewing only in `GET /sessions/me`**, or through a renewal endpoint (§3).
- **Writing on every request**, for an exact idle timeout: a write on the
  hottest read path, for a precision the NIST ceilings do not ask for.
- **Refreshing the cookie's `Max-Age` on each renewal:** the SSR probes drop
  `Set-Cookie`, so a renewal that reached only the server would leave the
  browser to drop a live cookie early. A `Max-Age` at the absolute deadline
  needs no refresh.
- **Checking the idle deadline on the session row at introspection**, with the
  token record holding the absolute deadline: the record is never written, but
  every cookie-authenticated request pays a second read to spare a rare second
  write.
- **Reading `default_ttl` as the idle timeout and `max_ttl` as the absolute
  cap:** no new key, but it silently loosens every server whose `default_ttl`
  was set as an absolute lifetime.
