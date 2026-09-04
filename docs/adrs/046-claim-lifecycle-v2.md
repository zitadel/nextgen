# ADR 046: Claim Lifecycle v2

> **Status:** Implemented (accepted 2026-07-24; fully implemented 2026-08-20)
> **Date:** 2026-07-24
>
> **Amendment (2026-08-20):** fully implemented. The server serves
> `/projects/{project_id}/claim/{init,status,complete}`: the claim service
> (#909) and the handlers with integration tests (#912) landed on top of the
> contract (#739), the `claim_challenges` storage (#628, #740), the
> platform-session precondition for `claim/complete` (#751), the CLI
> `zitadel claim` command (#754), and team attachment reporting in
> `setup`/`status`/`doctor` (#776). Claim state is the unique active
> owning-team grant in `authz_assignments` (the database enforces one owner
> per project), which anticipates proposed ADR 054 §2. The console claim page
> is still open (#615), so the browser leg of the flow has no guided UI yet.
>
> **Proposed amendment — [ADR 053 §5](053-cross-project-principals.md#5-first-party-human-sessions-may-call-the-operator-plane):**
> if ADR 053 is accepted, [§2](#2-claimcomplete-is-authenticated-by-a-platform-project-session)'s
> conclusion that SameSite semantics alone are sufficient against CSRF no longer
> holds. Cookie-authenticated unsafe requests — `claim/complete` included —
> additionally require an exact `Origin` match and a session-bound CSRF token in
> a non-simple header. SameSite becomes defense in depth rather than the only
> check. This is a wire-contract change to an already-implemented flow; do not
> implement §2's CSRF posture from this ADR alone.
>
> **Amendment (2026-08-31):** [§4](#4-the-personal-team-is-created-at-registration-not-at-claim)
> stated that team names are not unique. That was never true of the schema: the
> teams table has carried a case-insensitive unique index on the name, scoped to
> the project, since it was introduced, so team names are unique per project.
> §4 is corrected below, and the correction is load-bearing rather than
> editorial: it is what makes automatic personal-team provisioning converge.
> Because the name is derived per user — deterministically for one user and
> distinctly between users — two provisioning attempts racing for the same user
> compute the same name, so the index rejects the loser instead of minting a
> second team, while different users never block each other (#527, #979). This
> bounds *automatic provisioning* to one team per user; it does not change
> §Context's rule that a user may belong to many teams.
>
> **Context:** The server-side contract for **claim**: the operation that turns
> an unclaimed project into one owned by an accountable team. Supersedes the
> Withdrawn [ADR 003](003-create-first-claim-later.md), which removed the
> pre-claim/claim lifecycle from the CLI precisely until this contract existed.

This ADR supersedes [ADR 003](003-create-first-claim-later.md) and defines the
claim contract. The design docs [`claim-flow.md`](../design/platform/claim-flow.md)
and [`secret.md`](../design/platform/secret.md) describe a fuller *target* design
(secret rotation at claim, domain-based team matching, team creation at claim);
where they diverge from this ADR, this ADR governs. Those richer behaviors are
[non-goals](#non-goals) here and are left to later iterations.

## Context

A project is created anonymously and is authenticated only by possession of its
project secret, a bearer credential that carries no identity. **Claim is the
accountability event**: the moment a human identity attaches to the project so
that later audit trails, recovery, and governance point at a person. An agent
holding the secret can build and operate a project but cannot claim it, because
possession of a bearer is not an accountable identity.

The claiming human's account lives in the **platform project** (Zitadel's own
customer directory). Users are project-scoped per
[ADR 024](024-user-team-lifecycle-ownership.md), so the developers who claim
projects are a distinct population from the end-users inside the customer
projects they claim. Claim is therefore **pure association work**: it attaches an
already-authenticated platform user's team to the project.

Two facts from [ADR 024](024-user-team-lifecycle-ownership.md) shape the model:
a user is a project-scoped identity, and a personal team is an ordinary team
resource (not the user's lifecycle owner) of which a user may belong to many,
while a project belongs to exactly one team. The association claim creates is a
**grant in the permission engine** (ADR 032 to 034);
[ADR 033](033-internal-permission-management.md) keeps authorization facts in the
same database as the resources they protect and updates them in the same
transaction, which is what makes the claim write atomic.

Claim is a **cloud-only** concept: a self-hoster runs its own infrastructure and
has nothing to claim.

## Decision

### 1. Claim state is a permission-engine grant

Claim is realized as a single **grant** attaching the project to a team. There is
**no `project_claims` table and no `claimed` status field** on the project:
"claimed" means the project-to-team grant exists, with `claimed_at` its creation
timestamp, `team_id` its subject, and `claimed_by_user_id` its provenance. This
keeps claim state out of the `projects` table and is consistent with the standing
decision that claimed versus unclaimed is not a project status.

The human relates to the project only through the team; there is deliberately
**no direct user-to-project edge**. That indirection is what lets collaboration,
recovery, and transfer arrive later without remodeling.

**First-claim-wins** is enforced by the grant's uniqueness at write time, not in
application logic, and the `409 already_claimed` response is derived from the
existing grant.

The only new table this contract introduces is the ephemeral challenge:

```
claim_challenges(id, project_id, initiating_secret_hash, status, expires_at, created_at)
```

Writing the grant and marking the challenge completed happen in one transaction.

### 2. `claim/complete` is authenticated by a platform-project session

The browser-side `POST /projects/{id}/claim/complete` is authenticated by the
existing **`__nextgen_session` cookie** (the `nextgenSession` security scheme set
by the login flow after session exchange), not by an identity assertion supplied
in the request. The server derives `user_id` from the session.

A session may complete a claim only when it belongs to the **platform project**,
is **active**, and carries **at least one verified factor**; anonymous pre-login
sessions must never claim. Because the console and the API share an origin,
SameSite cookie semantics are sufficient against CSRF and no separate CSRF token
is introduced (to be revisited if the console ever moves to another origin).

The claim page reuses the existing login widgets (flow API and LiquidJS,
customized through their custom variables) wrapped in React inside `apps/console`.
Authentication runs through the flow engine and sets the session cookie; the
claim itself is then a plain `claim/complete` call that does not go through the
flow engine, and the backend is exercisable with `curl` alone.

### 3. `challenge_id` is an ephemeral identifier minted like a handoff token

[ADR 011](011-resource-identifiers.md) recognizes two identifier classes:
*managed* resources carry a client-visible prefixed string ID, while *ephemeral*
objects (sessions, auth attempts) use database-generated IDs and are never
addressed as REST resources. The claim challenge is **ephemeral** (10-minute TTL,
single use, never listed), but unlike a session it travels outside the system,
embedded in the `claim_url` the browser opens and in the `?challenge_id=` the CLI
polls with.

It is therefore minted like a **handoff token**
([`internal/domain/handoff_token.go`](../../internal/domain/handoff_token.go)):
128 bits from `crypto/rand`, a distinct prefix, base64url-encoded, with the
server storing only the SHA-256 hash. It is not a managed prefixed resource ID,
and it is not an encrypted opaque token: the challenge row exists regardless for
single-use and state, so encryption would only save a lookup that happens anyway.

A fast cryptographic hash (SHA-256), not a password KDF, is deliberate.
`challenge_id` carries 128 bits of `crypto/rand` entropy, so it is a generated
token rather than a low-entropy secret, and [ADR 029](029-cryptography-secrets-and-key-lifecycle.md)
accordingly hashes generated tokens with a plain cryptographic hash while
reserving argon2id for passwords. A slow KDF would add per-request cost without
raising the brute-force bar against a 128-bit random value, and its per-row salt
would break the deterministic hash-as-lookup-key the challenge row relies on.

Its role differs across the three endpoints (an RFC 8628-shaped init/poll/complete
dance):

1. **`POST /claim/init`** (CLI, authenticated by the project secret) creates the
   challenge and returns `challenge_id`, also embedded in the `claim_url`.
2. **`GET /claim/status?challenge_id=...`** (CLI poll) treats it as a **lookup
   key**, not a credential. The poll is authorized by the project secret, which
   must be the same one that initiated (its hash is stored at init, otherwise
   `403`). It returns `pending`, or `completed` with `team_id` / `claimed_at` /
   `dashboard_url`. It is a plain completion signal with no secret handover;
   `410` once expired.
3. **`POST /claim/complete`** (browser) treats it as **effectively a credential**.
   The browser never holds the project secret
   ([ADR 005](005-public-runtime-private-credentials.md)), so the `challenge_id`
   from the `claim_url` is its single-use, browser-safe stand-in: it proves
   someone holding the secret initiated this claim and handed over the URL. The
   session proves *who* the human is; the `challenge_id` proves they may claim
   *this* project.

**Security rationale.** A guessed pending `challenge_id` would let any
platform-account holder complete someone else's claim and attach the victim's
project to their own team: an in-flight hijack amounting to project takeover. The
window is narrow (10-minute TTL, single use, must match the path `project_id`),
but because the impact is takeover the value must be unguessable (128+ bits,
hashed at rest) and `complete` must be rate-limited.

### 4. The personal team is created at registration, not at claim

The user, their **personal team**, and their membership in it all exist before
claim: they are created when the user registers on the platform project. The
claim transaction only writes the project-to-team grant; it never creates a team
or a membership.

- Team names are unique per project, case-insensitively. (Postgres indexes
  `lower(name)`; SQLite and Spanner materialise a `name_lower` column because
  neither can index an expression. The invariant is the same on all three.) The
  personal team's name is therefore derived per user rather than shared: a
  single literal "Personal Team" would collide on the second registration. The
  name is a renamable placeholder, not an identifier.
- The contract constrains the name's *properties*, not the derivation. It must
  be **deterministic** for a given user, **distinct** between users, and
  **unlikely to be chosen by a human** naming an ordinary team. Determinism
  alone is not enough: a shared literal "Personal Team" is deterministic too,
  and it would make the first registration's name block every later one.
  - Determinism is what makes the unique index the concurrency guard: a second
    concurrent attempt for the same user computes the same name, collides, and
    converges on the winner instead of creating a second team.
  - Distinctness and unguessability are what keep one user's provisioning from
    being blocked by another user's team, or by a pre-existing team that
    happens to hold the name. A name that can be squatted turns a recoverable
    race into a permanent failure, because the same name is recomputed on every
    later attempt.
- This bounds *automatic provisioning* to one team per user. It is narrower
  than a limit on how many teams a user may belong to; per §Context a user may
  still belong to many.
- Automatic team creation is restricted to platform-project registrations;
  customer projects must not auto-create teams.
- A returning claimer reuses their one existing personal team (per ADR 024);
  every further claimed project attaches to it. Projects attach to the team,
  never directly to the user.
- There is no domain-based team matching and no join-existing-team flow;
  choosing a target team arrives later, once team invitations exist.

Registration and automatic personal-team creation are a platform-bootstrapping
concern tracked separately in [#527](https://github.com/zitadel/nextgen/issues/527)
and are a prerequisite for, not part of, this contract.

### 5. Claim identity is email registration and login only

The claim page authenticates the human with **email registration and login only**;
SSO and IdP-based identity are out of scope. Both email and SSO are wanted before
public launch, but SSO is a general identity concern solved once for the platform
rather than a claim-specific feature.

## Non-goals

The following are deliberately excluded from this contract. Each is a coherent
follow-up, and excluding it carries an accepted trade-off recorded here.

- **Secret rotation at claim.** The project secret is not rotated; the CLI records
  only `claimed_at` / `team_id` in `.zitadel/secret` and leaves the secret value
  unchanged, so `claim/status` carries no secret handover. Rotation is its own
  concern: it needs per-credential rotation semantics ([ADR 029](029-cryptography-secrets-and-key-lifecycle.md))
  and stateful secret validation in the auth path, which does not exist today
  (`SecurityHandler.HandleOAuth2` in `internal/api/security.go` authenticates a
  bearer by decrypting it and never compares it to the stored
  `projects.project_secret`, so changing the stored value would not invalidate
  the old secret). **Accepted trade-off:** the pre-claim secret stays valid after
  claim, so anyone who held it pre-claim retains API access until rotation ships.
- **Automated deletion of unclaimed projects.** The claim *window* itself is
  enforced, but only at claim time: `claim/init` and `claim/complete` refuse a
  project older than `domain.ClaimWindow` (14 days from `projects.created_at`)
  with `proj.claim_window_expired` (410), ordered after the already-claimed
  check so a claimed project keeps answering 409, and `claim/status` reports
  the same final 410 for a pending challenge, taking precedence over challenge
  expiry so a polling client learns the refusal no new challenge can fix. That
  lets CLI messaging state the deadline honestly. Deleting the project when the window closes stays out
  of scope: there is no general scheduled-task infrastructure in the server
  (the audit retention loop is audit-specific), and the proposed ADR 061
  ([#1119](https://github.com/zitadel/nextgen/pull/1119)), which designs one,
  explicitly excludes this sweeper. An expired-unclaimed project stays cheaply
  derivable (created
  long ago with no claim grant). **Accepted trade-off:** expired unclaimed
  projects accumulate, unclaimable, until a reaper ships on the ADR 061
  runtime.
- **Claim metrics and telemetry.** Claim volumes are answerable with ad-hoc
  queries over the grant data until a metrics surface is added.
- **Claim attributes on `GET /projects/{id}`.** `claimed_at` and `team_id` are
  properties of the grant, so surfacing them is a permission-surface concern, not
  part of creating the association.

Beyond these, the contract depends on **permission management**
([#419](https://github.com/zitadel/nextgen/issues/419), ADR 032 to 034) to store
the grant and on platform-project bootstrapping (§4) to pre-create the personal
team; neither is built here.

## Consequences

- ADR 003's Withdrawn lifecycle is re-proposed aligned to the surface actually
  being built, and ADR 003 is marked superseded by this ADR.
- The feature adds exactly one new table, `claim_challenges`. Because claim state
  lives in the permission grant, the `projects` table is untouched.
- The HTTP contract is simpler than the earlier draft: session authentication
  removes the need for a `verified_identity` object, and the pre-existing personal
  team removes the need for a `team_choice`.
- Two residual risks are accepted knowingly: the pre-claim secret remains valid
  after claim until rotation exists, and unclaimed projects accumulate until
  expiry exists. Both are observable.

## Rejected alternatives

- **A `project_claims` edge table.** The grant already carries `claimed_at`,
  `team_id`, and provenance and enforces first-claim-wins through its uniqueness,
  so a dedicated table would duplicate state the permission engine already owns.
- **A `claimed` status field on the project.** Rejected as a second source of
  truth on a table already in flux; deriving claimed-ness from the grant avoids
  it and matches the standing "not a project status" decision.
- **A managed, `chal_`-prefixed resource ID for the challenge.** The challenge is
  ephemeral, never listed, and never addressed as a REST resource; a managed ID
  would misclassify it and imply CRUD semantics it does not have.
- **An encrypted opaque token instead of a hashed random value.** Equivalent
  unguessability, but the challenge row is required anyway for single-use and
  state, so encryption saves only a lookup that happens regardless; the
  handoff-token pattern is simpler and already in the codebase.
- **Token-in-body authentication for `claim/complete`.** Sidesteps CSRF but
  exposes the session token to page scripts; with the console and API sharing an
  origin, the SameSite session cookie is both safer and simpler.
