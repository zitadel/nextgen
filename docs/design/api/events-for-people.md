# Events a person can read

> **Status:** draft proposal, 2026-11-11. Decision 3 is built; nothing else
> below is, unless a section says "Today". Decisions carry the markers of
> [README.md](README.md#status-markers). Once settled they become an amendment
> of [ADR 048](../../adrs/048-wide-events-internal-audit-primitive.md), entries
> in [events-catalog.md](events-catalog.md) and, for the console, entries in
> [decisions.md](../decisions.md).

## Goal

Someone opening Events wants to know **what happened, to whose account, who
did it, through what, from where and when**, from one row. Today the events
hold enough to reconstruct most of that, and no row says it.

## Today: one password sign-in

A sign-in through the login flow, ended by the app's handoff exchange, writes
ten events. Four are `request.api` rows. The audit view lists the other six,
each as its type, its record and its actor:

| # | Event | Record | Actor |
|---|-------|--------|-------|
| 1 | `auth.attempt.created` | auth attempt `att_…` | — |
| 2 | `auth.check.succeeded` | check `ch_…` | — |
| 3 | `auth.check.succeeded` | check `ch_…` | — |
| 4 | `auth.attempt.handed_off` | auth attempt `att_…` | — |
| 5 | `session.established` | session `sess_…` | `service` |
| 6 | `auth.token.issued` | token `tkn_…` | `user_…` |

Rows 5 and 6 are written by one request and disagree on its actor:
[decision 4](#4-the-actor-is-the-authenticated-caller).

What the six rows cannot say:

| Question | What a reader gets | Cause |
|----------|--------------------|-------|
| What happened | Six step names. Rows 2 and 3 look alike. | The rows are the server's steps. A check's type (`User`, `Password`) is in its payload. |
| Whose account | `user_id` on rows 2 to 6, and on a rejected password, since [decision 3](#3-one-column-for-the-user-an-event-concerns). No list row shows it. | Before, a user was named in `entity_id`, in a payload, in `actor_id`, or nowhere, and no filter reads a payload. |
| Who did it | A dash before the exchange. `service` with no ID for an API key. | A request without a credential has no actor. A key has an actor type and no `actor_id`, and `token_id` has no filter. |
| From where | Nothing. | Address, user agent and origin are stored only on `request.api`, which is dropped under load, and no list row, panel field or CSV column shows them. The exchange is the app server's request, so its address is the wrong one. |
| When | The same second on every row. | The store keeps microseconds; `GET /events` returns whole seconds. |
| How it ended | Present for success, by inference. | A rejected proof writes `auth.check.failed` with no user and no reason, in a transaction of its own whose failure is ignored. Nothing marks an attempt that was abandoned. |

Three more findings shape the proposal:

- **`session.established` means three things.** An anonymous `POST /sessions`,
  the exchange that gives a session its user, and an exchange into a session
  that already has its user all write it. The anonymous session a flow creates
  at its start writes nothing.
- **Three emitters choose their own actor**: the `auth.token.issued` of a
  user's token, a project claim and a personal team's creation. In the last,
  `team.created` names the user and the `authz.granted` written beside it
  names the caller.
- **Some fields are never written**: `client_id`, `fingerprint`, `team_id`,
  `delegation_id` and `grantor`. `delegation_type` is always `direct`, no
  event has actor type `agent` or category `signal`. The console offers
  Application and Device filters all the same.

The session row already holds the browser's address and user agent, written
when the browser opens the session, and a fingerprint when the client sent
one.

## Proposal

### 1. Outcomes and steps

**RECOMMENDED.** An event is an **outcome** or a **step**.

- An outcome is what a person would say happened: signed in, sign-in failed,
  session revoked, password set, user created, key issued.
- A step is how the server got there: attempt created, check succeeded, handed
  off, session token issued.

The audit view lists outcomes. A row's steps open beneath it through the
`flow_id` or `request_id` they share, as the event panel's timeline does now.

**OPEN: how a list reads outcomes alone.** The read has to stay one index
range per value, with no rows read and dropped.

| Mechanism | Cost |
|-----------|------|
| Steps get a category of their own, which the audit view does not read. **Recommended.** | A category value; the step types change category. A type must stay in one category, so the session token's issue needs a type apart from a key's. |
| The console names every outcome type. | About forty ranges merged for each page. A session token and a key share `auth.token.issued`. |
| The console hides steps it has read. | A page can come back mostly hidden. Not acceptable. |

### 2. A sign-in outcome is complete on its own row

**RECOMMENDED.** Two outcomes carry the sign-in, and each row answers the
goal's six questions without a join.

| Outcome | Event | Written |
|---------|-------|---------|
| Signed in | `session.established` | when an exchange gives a session its user |
| Sign-in failed | `auth.check.failed`, `auth.sso.authorization.failed`, `auth.sso.exchange.failed` | when a proof or a provider's answer is rejected |

`session.established` narrows to that one meaning:

- A session without a user is `session.created`, a step, written wherever one
  is created, the start of a flow included.
- An exchange into a session that already has its user is an event of its own
  (**OPEN:** its name), so a second factor later is not read as a sign-in.
- The session token an exchange replaces gets its `auth.token.revoked`. Today
  the token is deleted and nothing is written.

What each outcome carries:

| Question | Signed in | Sign-in failed |
|----------|-----------|----------------|
| Whose account | `user_id` ([decision 3](#3-one-column-for-the-user-an-event-concerns)) | `user_id`, once the attempt has resolved one |
| How | `payload.methods`: the check types this attempt verified | `payload.check_type` (today) and `payload.reason` |
| From where | `metadata.client` and `fingerprint` of the browser ([decision 5](#5-from-where)) | the same, from the failing request itself |
| Through what | the calling key, as `token_id` and the actor | none: the browser calls the flow itself |
| Which sign-in | `flow_id`, `session_id` | `flow_id`, `session_id` |

`reason` needs a cause the server does not keep today: every rejected proof
returns the same error. The event takes a second, internal value
(`wrong_credential`, `unknown_identifier`, `expired_challenge` and what the
lockout policy adds), which the visitor never sees.

A failed check is written after its transaction has failed, and an error
writing it is dropped. **RECOMMENDED:** log that error; an outcome that goes
missing must not go missing silently.

**Alternative, not recommended:** one new event per attempt
(`succeeded`, `failed`, `expired`). It gives one type family to list, and it
repeats what `session.established` and `auth.check.failed` already record. An
attempt has no moment at which it fails: a visitor may retry. `expired` needs
a job that notices.

**OPEN: the flow's purpose** (`login`, `register`, `recovery`, `reauth`) on
the outcome. The exchange does not know it; the attempt would have to store
it at handoff, as it stores `flow_id`.

### 3. One column for the user an event concerns

**BUILT (2026-11-11).** `events` has `user_id`: the user whose account the
event is about, whoever acted. It is an ID like `actor_id`, and it adds no
personal data.

- **Filter:** `GET /events?user_id=…`, read from an index shaped as the
  actor's and the resource's are: project, user, category, time, ID, leaving
  out the rows that name no user. All three dialects have it;
  [ADR 048](../../adrs/048-wide-events-internal-audit-primitive.md#amendment-2026-11-11-the-user-an-event-concerns)
  has the measurement.
- **Two questions, two filters.** `actor_id` answers what a principal did.
  `user_id` answers what happened to an account: its sign-ins, the attempts
  against it, its credential changes, and what an administrator did to it.
- **Who sets it:** the emitter, through `EmitSpec.UserID`. The
  [catalog](events-catalog.md#the-user-an-event-concerns) lists the types
  that do, and a test holds every emitter to that list.
- **The name** is `user_id`: it matches the payload field and the glossary,
  and `subject` reads as OIDC's `sub`.
- **`payload.user_id` stays** on the events that have it. Retiring it changes
  their contract and gives a reader nothing yet.
- Stored events are not backfilled.
- Invitations and team memberships set it once they have an emitter.

### 4. The actor is the authenticated caller

Two positions:

- **The caller, always.** `actor_id` and `actor_type` come from the request's
  credential, in one place, and no emitter overrides them. The exchange's
  actor is the app's key; the user it signs in is `user_id`. A row never mixes
  two principals, the same request's `request.api` agrees with it, and the
  rule holds unchanged for a step-up, an administrator acting as a user, an
  agent, a personal access token and an authorization-code client.
- **The user who signed in.** `session.established` and `auth.token.issued`
  name the session's user as actor, as two other emitters do for theirs. It
  reads well in a list with an Actor column, and without `user_id` it is the
  only indexed place the user appears.

**RECOMMENDED: the caller, always**, and the three existing exceptions go
with it. With `user_id` the second position has nothing left to add, and
three emitters deciding for themselves have already drifted apart.

With it:

- **A request without a credential** has actor type `anonymous`. Today it has
  none, which also describes a server job and a bug.
- **An API key has an `actor_id`**: its token ID now, its key ID once keys are
  resources ([credentials.md](credentials.md)). The actor index then answers
  what a key did, with no index on `token_id`.

**LOCKED (2026-11-11): until this is built, both events keep the actor they
have**, the caller on `session.established` and the user on
`auth.token.issued`. Naming the user on both was weighed and dropped: it
would have changed the session event's actor twice.

### 5. From where

**RECOMMENDED.** An outcome carries the browser's address, user agent and
origin in `metadata.client`, the shape `request.api` uses, and its
fingerprint in the `fingerprint` column when the client sent one.

- **Signed in:** the exchange is the app server's request, so these come from
  the session's browser record. **OPEN:** refresh that record at handoff, the
  flow's last browser request, or accept the values from when the session
  opened.
- **Sign-in failed:** the failing request is the browser's own.
- **Privacy.** The same three values are stored today, on `request.api`. This
  moves them onto rows that are never dropped and are retained as audit
  events, so ADR 048's deny-by-default list gains them, for sign-in outcomes
  only.
- **`client_id`** stays empty until there are clients to name
  ([ADR 082](../../adrs/082-oauth-and-oidc-server.md)). Until then the origin
  says where the person was.
- The console drops its Application and Device filters until something writes
  those fields.

### 6. When

**RECOMMENDED.** `GET /events` returns the precision the store keeps. The
spec's `occurred_at` and `created_at` take a time layout with fractional
seconds (the generator's `x-ogen-time-format`); the console already shows
milliseconds when it is sent them.

**OPEN: order inside one request.** The list sorts by `created_at`, then ID,
and shows `occurred_at`. On Postgres and SQLite the events of one transaction
are stamped apart, so they sort as written. On Spanner they share the commit
timestamp and their IDs are random. A probe at machine speed also saw a
`request.api` event's `occurred_at` land after the changes its request made,
where the catalog says it sorts first; that needs a test before anything is
built on it. A sequence number per request would settle both, and it is a
column in every index's sort key.

### 7. In the console

**RECOMMENDED**, to be designed and recorded in
[decisions.md](../decisions.md):

- **A sentence a row**, built from the event's fields by type: "Ada signed in
  with a password, through Acme web". The type stays visible and is what a
  filter and the API name.
- **Names when the page loads.** The console resolves the IDs a page shows to
  what the user and the key are called now, and shows the ID for one that no
  longer exists. Events keep IDs only.
- **Through.** The calling key is labelled as what the call came through. It
  is not listed as "Token" beside a person.
- **A user's activity**: `user_id` on the user's page.
- **A sign-in's panel**: the outcome, its context (browser, address, origin),
  then its steps with the time between them.
- The CSV gains the token and the client context.

## Not proposed

- **A table of flows or sign-ins.** The outcome events list sign-ins from the
  indexes there are. A table earns its place only for abandonment and funnels.
- **Names or email addresses in events.**
- **Searching payloads.**
- **An index on `token_id`.** Every authenticated request carries one.
- **Grouping by flow in the browser.** Pages cut flows in half.

## Order of work

1. **The actor rule** (decision 4), now that events name their user.
2. **Complete sign-in outcomes** (decisions 2 and 5), with the session types
   and the missing revoke.
3. **Outcomes apart from steps, and the time on the wire** (decisions 1 and 6).
4. **The console** (decision 7).

Built so far, and kept by every step: `token_id` is the credential a request
presented, an SSO callback's events carry their flow, and events name the
user they concern (decision 3).
