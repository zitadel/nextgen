# ADR 003: Create First, Claim Later

> **Status:** Proposed
> **Date:** 2026-04-26
> **Updated:** 2026-05-31
> **Context:** AI-native Zitadel CLI onboarding and project lifecycle

## Decision

Zitadel Cloud supports a create-first, claim-later project lifecycle backed by
the server project API.

A developer or agent can create a project without signing up. The CLI writes the
server-issued project credentials to `.zitadel/secret`, scaffolds local
configuration, and allows local development immediately. Claim becomes mandatory
before the project can be shared through preview infrastructure or deployed to
production.

Claim is the accountability event. It attaches the project to a team in the
platform project, records an accountable human, rotates the full project secret,
and preserves the project id, preview origin metadata, flow definitions, users,
sessions, factors, and declared issuers already bound to the project.

Agents can configure projects, write `.zitadel/` resources, run `zitadel plan`,
and run `zitadel apply` for local development. Agents cannot complete claim or
enable paid capabilities. Human claim uses GitHub, Google, or email magic-link
authentication.

## Prior Withdrawal

This ADR was previously withdrawn because the CLI and api-mock carried a
pre-claim concept without a server-side claim contract. The old endpoints
`/projects/{id}/claim/init` and `/projects/{id}/claim/status` were intentionally
removed until the backend shape existed.

This update reactivates the decision with the server-backed API contract and the
current CLI vocabulary: `setup`, `plan`, `apply`, `status`, and `claim`.

## API Shape

Anonymous project creation:

```http
POST /projects
Idempotency-Key: <client retry key>

{
  "preview_origins": ["*.vercel.app"]
}
```

The response returns the stable project id, the full pre-claim project secret,
the origin-scoped preview secret, lifecycle state, and claim requirements:

```json
{
  "project_id": "river-8421",
  "project_secret": "sk_proj_...",
  "preview_secret": "sk_proj_...",
  "preview_origins": ["*.vercel.app"],
  "lifecycle": "unclaimed",
  "claim_required_for": ["preview", "production"],
  "created_at": "2026-05-31T12:00:00Z"
}
```

Project reads never return secret material:

```http
GET /projects/{project_id}
Authorization: Bearer sk_proj_...
```

Configuration apply is environment-aware:

```http
PATCH /projects/{project_id}/config?environment=development
PATCH /projects/{project_id}/config?environment=preview
PATCH /projects/{project_id}/config?environment=production
```

Development applies are allowed before claim. Preview and production applies
return `409 claim_required` while the project is unclaimed.

Human claim is a device-flow-shaped exchange:

```http
POST /projects/{project_id}/claim/init
Authorization: Bearer sk_proj_...

GET /projects/{project_id}/claim/status?challenge_id=...
Authorization: Bearer sk_proj_...
```

The browser completes:

```http
POST /projects/{project_id}/claim/complete
```

The browser never receives the rotated secret. The CLI polls with the pre-claim
secret that initiated the challenge; the first completed status response returns
the new project secret exactly once and erases the stashed value server-side.

## CLI Behavior

`zitadel setup` creates the unclaimed project, writes `.zitadel/secret`, writes
`zitadel.json`, scaffolds local resources, and runs the local `apply` path for
development.

`zitadel plan --environment preview` and
`zitadel apply --environment preview` fail with `E_CLAIM_REQUIRED` until the
project is claimed. Production behaves the same way. Local development remains
unblocked so agents can build auth before the human signs up.

`zitadel deploy connect --environment preview` also fails while unclaimed. A
preview deploy is a sharing boundary, so it needs a human owner before the
origin-scoped secret is handed to the deploy platform.

`zitadel claim` starts the challenge, opens the browser in interactive mode, and
polls for completion. In `--non-interactive --json` mode it returns the
`claim_url`, `challenge_id`, and `expires_at` so an agent can hand the URL to the
human without impersonating them.

After claim, the CLI atomically rewrites `.zitadel/secret` with the rotated
project secret, preserved preview secret, `team_id`, `claimed_at`, and
`lifecycle: "claimed"`.

## Consequences

- Creation is no longer gated by signup, email verification, team creation, or
  plan selection.
- Claim is free and mandatory at the first sharing/deploy boundary.
- Preview and production have a human accountable party before remote secrets are
  installed or remote config is accepted.
- The project id is stable for the lifetime of the project.
- Users, sessions, factors, flow definitions, config, and declared issuers do
  not move during claim.
- The CLI remains agent-friendly: every command supports
  `--non-interactive --json`, and agents prefer structured `next_commands`.

## Out Of Scope

- Billing and paid capability activation.
- Team merge and project transfer.
- Long-term secret restore.
- Full self-host claim semantics. Self-host starts from an accountable operator
  path and does not need this claim flow for MVP.
