# ADR 041: Claim Lifecycle v2

> **Status:** Accepted
> **Date:** 2026-07-24
> **Context:** The server-side contract for **claim**: the operation that turns
> an unclaimed project into one owned by an accountable team. Supersedes the
> Withdrawn [ADR 003](003-create-first-claim-later.md), which removed the
> pre-claim/claim lifecycle from the CLI precisely until this contract existed.

This ADR **supersedes [ADR 003](003-create-first-claim-later.md)** and is the
single source of truth for the claim design. It consolidates the decisions taken
across the [epic #96 breakdown and grooming discussion](https://github.com/zitadel/nextgen/issues/96#issuecomment-4923654787)
so the implementation tickets (the OpenAPI contract, the migration, the service,
the CLI, and the console page) point at one document instead of re-deriving
intent from a long comment thread.

The design docs [`claim-flow.md`](../design/platform/claim-flow.md) and
[`secret.md`](../design/platform/secret.md) still describe the fuller *target*
design (secret rotation at claim, domain-based team matching, team creation at
claim). Where they diverge from this ADR, **this ADR governs the MVP**; those
sections describe future iterations, not what MVP claim ships.

## Context

Claim is fully designed but has zero implementation. ADR 003 is Withdrawn,
explicitly pending "a server-side `claim` contract"; the design lives in
[`claim-flow.md`](../design/platform/claim-flow.md),
[`secret.md`](../design/platform/secret.md), and the draft
[`claim-api.yaml`](../design/platform/api/claim-api.yaml). Since those drafts
were written, the epic revised several decisions, which this ADR records.

- **Claim is cloud-only.** Self-hosters manage their own infrastructure and have
  nothing to claim. The Vercel-style backend-hosting option complements the
  cloud rather than replacing it, so claim stays relevant.
- **Pre-claim, the human has no identity link to the project.** The only
  association is *possession of the project secret*, which is a bearer, not an
  identity. Claim is "the accountability event": the moment a human identity
  attaches to the project. Agents therefore cannot claim, because a post-claim
  audit trail must point at a human.
- **Claim is pure association work.** An already-authenticated platform user's
  personal team gets the project attached to it. The claiming human's account
  lives in the **platform project** (Zitadel's own customer directory); users
  are project-scoped per [ADR 024](024-user-team-lifecycle-ownership.md), so
  developers claiming projects are a different population from the end-users
  inside the claimed customer projects.
- **This builds on [ADR 024](024-user-team-lifecycle-ownership.md)**: users are
  project-scoped identities, a personal team is a normal team resource (not the
  user's lifecycle owner), and a user may be a member of many teams while each
  project belongs to exactly one team.
- **The association is a grant in the permission engine** (the ADR 032 to 034 /
  [#419](https://github.com/zitadel/nextgen/issues/419) track), not a new
  first-class table. [ADR 033](033-internal-permission-management.md) keeps
  authorization facts in the same database as the resources they protect,
  updated in the same transaction, which makes the claim transaction feasible.

## Decision

### 1. Claim state is a permission-engine grant

There is **no `project_claims` edge table and no project status field**. The
claim is realized as a single **grant** in the permission engine attaching the
project to a team. "Claimed" means the project to team grant exists; `claimed_at`
is the grant's creation timestamp, `team_id` is its subject, and
`claimed_by_user_id` is its provenance. This is consistent with #405's decision
that "claimed / unclaimed is not a project status".

There is deliberately **no direct user to project edge**: the human relates to
the project only through the team. That indirection is what lets collaboration,
recovery, and transfer arrive later without remodeling.

**First-claim-wins** is enforced at the grant write (the grant's uniqueness), not
in application logic, and the `409 already_claimed` payload (team id, dashboard
URL) derives from the existing grant.

The only new table this epic owns is the ephemeral challenge:

```
claim_challenges(id, project_id, initiating_secret_hash, status, expires_at, created_at)
```

Writing the grant and marking the challenge completed happen in **one
transaction** (feasible because authorization rows live in the same database as
the resources).

### 2. `claim/complete` is authenticated by a platform-project session

The browser-side `POST /projects/{id}/claim/complete` is authenticated by the
existing **`__nextgen_session` cookie** (the `nextgenSession` security scheme
already set by the login flow after session exchange), **not** by an identity
token supplied by the browser. This resolves the `verified_identity` TODO in the
draft `claim-api.yaml`: the server derives `user_id` from the session rather than
trusting a browser-supplied assertion.

Requirements on the session before it may claim:

- it belongs to the **platform project**,
- it is **active**, and
- it has **at least one verified factor**; anonymous pre-login sessions (short
  TTL) must never be able to claim.

**CSRF:** the console and the API share the same domain, so SameSite cookie
semantics are sufficient for the MVP; no separate CSRF token is added. Revisit if
the console ever moves to a different origin.

The claim page reuses the **existing login widgets** (flow API + LiquidJS,
customized for the claim context through their custom variables) wrapped in
custom React inside `apps/console`. Authentication runs through the flow engine
and sets the session cookie; the claim itself is then a plain `claim/complete`
call and does **not** go through the flow engine. The backend is fully testable
via `curl` without any of the console UI.

### 3. `challenge_id` is an ephemeral identifier minted like a handoff token

[ADR 011](011-resource-identifiers.md) defines two identifier classes: *managed*
resources get a client-visible prefixed string ID; *ephemeral* objects (sessions,
auth attempts) use DB-generated IDs and are never addressed as REST resources.
The claim challenge is **ephemeral** (10-minute TTL, single use, never listed),
but unlike a session it travels outside the system, embedded in the `claim_url`
the browser opens and in the `?challenge_id=` the CLI polls with.

It is therefore minted like a **handoff token**
([`internal/domain/handoff_token.go`](../../internal/domain/handoff_token.go)):
128 bits from `crypto/rand`, a distinct prefix, base64url-encoded, with the
server storing **only the SHA-256 hash**. It is **not** a managed, `chal_`-style
prefixed resource ID, and it is not an encrypted opaque token: the challenge row
is needed anyway for single-use and pending/completed state, so encryption would
only save a lookup that happens regardless.

Its role differs per endpoint across the RFC 8628-shaped init/poll/complete
dance:

1. **`POST /claim/init`** (CLI, authenticated by the project secret) creates the
   challenge and returns `challenge_id`, also embedded in the `claim_url`. Here
   it is just an identifier handed back.
2. **`GET /claim/status?challenge_id=...`** (CLI poll): here it is a **lookup
   key**, not a credential, saying which attempt the CLI is asking about. The
   poll is authorized by the project secret, which must be the **same** secret
   that initiated (its hash is stored at init; otherwise `403`). Returns
   `pending`, or `completed` with `team_id` / `claimed_at` / `dashboard_url`.
   It is a plain completion signal, with **no secret handover** (rotation is
   descoped, see §6). `410` on expiry.
3. **`POST /claim/complete`** (browser): here `challenge_id` is **effectively a
   credential**. The browser never holds the project secret
   ([ADR 005](005-public-runtime-private-credentials.md)), so the `challenge_id`
   from the `claim_url` is its single-use, browser-safe stand-in: it proves
   "someone holding the secret initiated this and handed me this URL". The
   session proves *who* the human is; the `challenge_id` proves they may claim
   *this* project.

**Security rationale.** If a pending `challenge_id` were guessed, an attacker
with any platform account could complete someone else's claim and attach the
victim's project to their own team, an in-flight claim hijack amounting to
project takeover. The window is narrow (10-minute TTL, single use, must match the
`project_id` in the path), but because the impact is takeover the value must be
**unguessable** (128+ bits, hashed at rest) and `complete` must be
**rate-limited**.

### 4. The personal team is created at registration, not at claim

The user, their **"Personal Team"**, and their membership in it all exist
*before* claim: they are created once, when the user registers on the platform
project (owned by the bootstrapping prerequisite
[#527](https://github.com/zitadel/nextgen/issues/527), not this epic). The claim
transaction only writes the project to team grant; it never creates a team or a
membership.

- The team is named **"Personal Team"**; the user can rename it later in the
  console. Team names are **not unique**.
- Auto-creation is **restricted to platform-project registrations**: customer
  projects must not auto-create teams.
- **Returning claimers reuse the same existing team** (per ADR 024). The
  developer is one self-owned user; every further claimed project attaches to
  their single existing personal team. Projects attach to the team, never
  directly to the user.
- There is **no domain-based team matching**, no `/teams/domain-match`, and no
  join-existing-team flow in the MVP. Those (and choosing a target team) come
  later, after team invitations exist.

### 5. Claim identity for the MVP is email registration and login only

The first iteration authenticates the human with **email registration / login
only**, with no SSO or IdP. IdP/SSO registration and management is its own epic;
both email and SSO are required by public launch, but SSO is solved generally
first rather than as a claim-specific feature.

### 6. Prerequisites and descopes, with accepted risks

**Descoped for the MVP:**

- **No secret rotation at claim.** `claim/status` is a plain completion signal
  with no one-shot secret stash, and the CLI does not replace the secret; it only
  records `claimed_at` / `team_id` in `.zitadel/secret` (the secret value is
  unchanged). Rotation is its own epic: it needs rotation semantics per
  credential type, the `sk_proj_` scheme, and (as a hard prerequisite) making the
  global auth path stateful. Today `SecurityHandler.HandleOAuth2`
  (`internal/api/security.go`) authenticates a bearer by decrypting it and never
  compares it to the stored `projects.project_secret`, so rotating the stored
  value would not invalidate the old secret.
  **Accepted risk:** the pre-claim secret **stays valid after claim**. Anyone who
  obtained it pre-claim keeps API control until rotation ships, consistent with
  the epic's "shared local access / first claim wins" stance.
- **No automated 14-day expiry / deletion.** This needs scheduled-task / job
  infrastructure that does not exist in the server today (all TTLs are read-time
  filtering). Interim: unclaimed projects persist unenforced; CLI messaging
  frames them as temporary **without promising deletion**; expired-unclaimed
  stays cheaply derivable (created 14+ days ago with no claim grant).
- **No claim metrics / telemetry** in the MVP; claim volumes are answerable with
  ad-hoc queries on the grant data until a metrics follow-up.
- **No claim fields on `GET /projects/{id}`.** `claimed_at` / `team_id` are
  attributes of the grant, so exposing them is a permission-surface concern owned
  by the permission-management track, not this epic.

**Hard prerequisites, owned outside this epic:**

- **Platform-project bootstrapping ([#527](https://github.com/zitadel/nextgen/issues/527)).**
  Registration/login on the platform project and automatic "Personal Team"
  creation at registration (§4). A narrow slice, PB0
  ([#605](https://github.com/zitadel/nextgen/issues/605)), is split out so the
  claim service and console page can start without waiting on #527's full scope.
- **Permission management ([#419](https://github.com/zitadel/nextgen/issues/419),
  ADR 032 to 034).** The project to team association that claim writes *is* a
  grant in the permission system; claim cannot write its one association until
  the permission layer can store it.

## Consequences

- ADR 003's Withdrawn lifecycle is re-proposed aligned to the surface actually
  being built; ADR 003 is marked superseded by this ADR.
- Downstream tickets (OpenAPI contract, migration, session-verification helper,
  storage/service, CLI, console page) have a single reference and no longer
  re-derive intent from the epic thread.
- This epic adds exactly **one new table**, `claim_challenges`; the association
  itself is grant state owned by the permission engine, so the `projects` table
  (actively reshaped elsewhere) is untouched.
- The OpenAPI contract simplifies against the draft: no `verified_identity`
  object (session auth replaces it) and no `team_choice` (the personal team
  pre-exists).
- **Residual accepted risks:** the pre-claim secret remains valid post-claim
  until the rotation epic, and unclaimed projects accumulate unenforced until
  expiry infrastructure lands. Both are observable and were accepted knowingly.
- The epic is **blocked** at the ticket level on #527 (PB0) and #419; only this
  ADR and the OpenAPI contract are useful work until those land.

## Rejected alternatives

- **A `project_claims` edge table.** Superseded by the grant model: the grant
  already carries `claimed_at` / `team_id` / provenance and enforces
  first-claim-wins via its uniqueness, so a second table would duplicate state
  the permission engine owns.
- **A `claimed` status field on the project.** Rejected by #405 ("claimed /
  unclaimed is not a project status") and reaffirmed here; deriving the state
  from the grant avoids a second source of truth on a table already in flux.
- **A managed, `chal_`-prefixed resource ID for the challenge.** Rejected: the
  challenge is ephemeral, never listed, and never addressed as a REST resource;
  a managed ID would misclassify it and imply CRUD semantics it does not have.
- **An encrypted opaque token instead of a hashed random value.** Equivalent
  unguessability, but the challenge row is required anyway for single-use and
  state, so encryption saves only a lookup that happens regardless; the
  handoff-token pattern is simpler and already in the codebase.
- **Token-in-body/header auth for `claim/complete`.** Sidesteps CSRF but exposes
  the session token to page scripts; with the console and API sharing a domain,
  the SameSite session cookie is both safer and simpler.
