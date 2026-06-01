# Project Secret

> **Status:** Draft
> **See also:** [README](README.md) · [Overview](overview.md) · [Configuration Surface](configuration-surface.md) · [Claim Flow](claim-flow.md) · [Claim API](api/claim-api.yaml) · [Glossary](../glossary.md) · [Credentials (canonical taxonomy)](../api/credentials.md)

The project secret is a server-issued bearer token that authenticates SDK and CLI calls against a project. Before claim, it is the only authentication on the project. After claim, it is rotated to a **claimed credential** bound to the team that claimed the project. The same file on disk (`.zitadel/secret`) also carries an **origin-scoped project secret** (historically called the "preview secret") — a companion token reserved for preview-runtime handoff after claim.

This document specifies how the secrets are generated, stored, validated, and rotated — and what each one can and cannot do. For the full credential taxonomy across the API, see [`../api/credentials.md`](../api/credentials.md).

## What this is, briefly

The project secret is a bearer token. It authenticates API calls. That's it. It is not a user identity, not a team membership, not a billing account, not a long-term shared credential for a group of people. Teammates get access via claim and team membership — not by passing `.zitadel/secret` around.

## Generation

Both secrets are **generated server-side** at `POST /projects`. The client does not contribute randomness. Base62-encoded, prefixed by type. All project-scoped secrets share the `sk_proj_` prefix; variants are distinguished by metadata the server records at mint time:

- `sk_proj_<base62>` with `pre_claim: true` — the full-access pre-claim project secret.
- `sk_proj_<base62>` with `origin_patterns: [...]` — the origin-scoped variant (the "preview secret"). Restricted to calls whose `Origin` matches one of the patterns.

The setup CLI sends the desired `preview_origins` patterns (inferred from detected deploy tooling — e.g. `["*.vercel.app"]` when it sees a `vercel.json`, `["*.netlify.app"]` for Netlify, `["*.pages.dev"]` for Cloudflare Pages). The server validates the patterns against an allowed list and rejects anything it doesn't recognize.

Server response from `POST /projects`:

```json
{
  "project_id": "river-8421",
  "project_secret": "sk_proj_7kR2pXq9vN3wLmYhT4cB8A",
  "preview_secret": "sk_proj_c3f7a8b2vL4nYwH6...",
  "preview_origins": ["*.vercel.app", "*.netlify.app"],
  "lifecycle": "unclaimed",
  "claim_required_for": ["preview", "production"],
  "created_at": "2026-04-21T14:03:11Z"
}
```

The setup CLI maps that response to `.zitadel/secret`:

```json
{
  "project_id": "river-8421",
  "project_secret": "sk_proj_7kR2pXq9vN3wLmYhT4cB8A",
  "preview_secret": "sk_proj_c3f7a8b2vL4nYwH6...",
  "preview_origins": ["*.vercel.app", "*.netlify.app"],
  "lifecycle": "unclaimed",
  "created_at": "2026-04-21T14:03:11Z"
}
```

> **Note:** `secret` and `preview_secret` share a prefix (`sk_proj_`). They are distinct keys with distinct scope metadata. The "preview" field name is retained for continuity; canonically it is an origin-scoped `sk_proj_`.

## Storage

`.zitadel/secret` lives at the root of the `.zitadel/` directory:

```
my-app/
├── zitadel.json            (source-controlled — see configuration-surface.md)
├── .zitadel/
│   ├── secret              (gitignored — this file)
│   ├── flows/              (source-controlled)
│   ├── schemas/            (source-controlled)
│   └── ...
└── .gitignore              (setup CLI adds `.zitadel/secret` automatically)
```

**The setup CLI appends `.zitadel/secret` to `.gitignore` automatically on first run.** This is non-negotiable — committing the project secret is equivalent to publishing a root credential. The file is written with `0600` permissions on POSIX (owner read/write only); Windows gets the equivalent ACL.

### Preview secret handoff

After the file is written, the origin-scoped preview secret remains local while
the project is unclaimed because a preview deployment is a sharing boundary.
This PR does not ship deploy-platform commands; future deploy integration can
upload the origin-scoped secret to platform environment stores only after
`zitadel claim` completes.

The origin-scoped secret's origin patterns are enforced server-side on every request, so an accidentally-leaked preview secret still cannot authenticate from `api.acme.com` or any other non-matching origin.

## Validation and revocation

Every SDK request presents the appropriate secret as a bearer token. The server looks up the secret, checks:

1. **Format and existence** — is this a recognized `sk_proj_…` token still on record?
2. **Origin / Host (origin-bound requests)** — for the origin-scoped variant, does the incoming request's `Origin` header (or `Host`, where the runtime cannot send `Origin`) match the patterns captured at mint time? Browser/runtime requests authenticated with the full project secret may also be checked against the declared issuer list for the active environment.
3. **Environment scope** — origin-scoped secrets are implicitly scoped to non-production; they cannot authenticate production-origin requests.

CLI and other direct platform calls authenticated with the full project secret are not expected to present a customer origin; they remain valid without that check.

Mismatches produce HTTP 403 with a structured error and are logged.

Revocation is through rotation: a future post-claim secret rotation flow issues a new `sk_proj_…` and invalidates the old. The origin-scoped secret can be rotated independently from the dashboard.

## Capability matrix

| Action | Project secret (`sk_proj_…`, pre-claim) | Origin-scoped secret (`sk_proj_…`) | Claimed credential (`sk_proj_…`, post-claim) |
|---|---|---|---|
| Read the project's own configuration | Yes | No | Yes |
| `npx zitadel apply` — upload config | Yes for development only | **No** | Yes |
| Read users this project has created | Yes | Yes (scoped to claimed preview environments) | Yes |
| Register new users, authenticate sessions | Yes | Yes (scoped origins) | Yes |
| Send magic links / OTP to the dev inbox | Yes | Yes | Yes |
| Send real email / SMS | **No** | **No** | Yes (Pro for managed; Free with BYO) |
| Read resources of **another project** | No | No | No |
| Create or modify billing state | No | No | Yes (owner role) |
| Add IDP, SSO, SCIM, SAML connections | No | No | Yes (Pro-gated) |
| Invite team members | No (no team exists) | No | Yes (owner role) |
| Claim this project | Requires human auth — secret alone cannot | No | — (already claimed) |

All "No" rows are enforced server-side, not by SDK convention.

## What changes at claim

Claim is specified in [claim-flow.md](claim-flow.md). From the secret's perspective, the operation is:

1. **The `sk_proj_…` project secret is rotated.** The server invalidates the pre-claim value and issues a new `sk_proj_…` bound to the newly attached team. The CLI overwrites `.zitadel/secret` atomically.
2. **The origin-scoped secret is preserved.** Its origin patterns don't change. Any CI pipeline or deploy env using it keeps working.
3. **Nothing else moves.** `project_id` has been stable since creation. Users, factors, sessions, configs, declared issuers — all bound to `project_id` from day one. Claim attaches *ownership*, not *identity*.

Post-claim `.zitadel/secret`:

```json
{
  "project_id": "river-8421",
  "project_secret": "sk_proj_9f2Hx8LqT4vRmYpN2wCbVa",
  "preview_secret": "sk_proj_c3f7a8b2vL4nYwH6...",
  "preview_origins": ["*.vercel.app", "*.netlify.app"],
  "lifecycle": "claimed",
  "created_at": "2026-04-21T14:03:11Z",
  "claimed_at": "2026-04-22T09:17:45Z",
  "team_id": "team_acme"
}
```

## Failure modes

**Laptop swap.** A developer pulls the repo on a second machine; `.zitadel/secret` is gitignored and therefore absent. If `zitadel.json` references a project slug, the SDK prompts:

```
Zitadel is configured in this project but no secret was found on this machine.
  Claim or restore from your Zitadel account when restore ships.
  Or create a fresh project with: npx zitadel setup --force
```

Future restore authenticates the human via the standard claim methods and refreshes both secrets for any project the human owns. It only works post-claim — there is no human to authenticate against while the project is unclaimed.

**Lost secret before claim.** The project has no accountable owner; recovery is best-effort. Support can correlate browser sessions that visited the scratch dashboard, recent CLI backups at `~/.zitadel/secret-backup`, and Git-remote hints. The CLI nudges on every boot:

```
⚠ Unclaimed projects are ephemeral. If you've built something you care about,
  claim it now: npx zitadel claim
```

**Shared repo pull.** Two developers, one repo, neither has the secret. If claimed: future restore lets team members recover from their account. If unclaimed: only the original creator can recover; everyone else creates a new project or waits for the first person to claim.

## Lifecycle

```mermaid
sequenceDiagram
    participant Dev as Developer / Agent
    participant CLI as zitadel CLI
    participant Srv as Zitadel Server
    participant Secret as .zitadel/secret

    Dev->>CLI: npx zitadel setup
    CLI->>CLI: detect framework + deploy tool<br>infer preview_origins
    CLI->>Srv: POST /projects { preview_origins }
    Srv->>Srv: generate sk_proj_ secrets server-side
    Srv-->>CLI: { project_id, project_secret, preview_secret, preview_origins }
    CLI->>Secret: write file (0600, gitignored)
    CLI->>Dev: print claim-required warning<br>for preview/production deploys
    CLI->>Dev: print project slug + scratch URL + dev inbox

    Note over Dev,Srv: Days/weeks of development.<br>Every API request carries a bearer secret.

    Dev->>CLI: npx zitadel claim
    CLI->>Srv: claim flow (see claim-flow.md)
    Srv->>Srv: rotate sk_proj_ secret<br>attach team
    Srv-->>CLI: { rotated_project_secret, team_id, claimed_at }
    CLI->>Secret: rewrite file atomically

    Note over Dev,Srv: project_id, preview_secret, and all resources unchanged.<br>Only the full-access sk_proj_ bearer value rotates.
```

## CLI surface

The current CLI surface that touches project lifecycle state:

| Command | Purpose |
|---|---|
| `npx zitadel setup` | Create project, write `.zitadel/secret`, and scaffold local development. |
| `npx zitadel plan` | Validate local config and preview the sync diff. Preview and production require claim. |
| `npx zitadel apply` | Upload repo-owned config. Development is allowed before claim; preview and production require claim. |
| `npx zitadel status` | Print project slug, claim state, and local issuer summary. Never prints secret values. |
| `npx zitadel claim` | See [claim-flow.md](claim-flow.md). |

Secret restore, rotation, and deploy-platform secret handoff are future work.

## See also

- [Claim Flow](claim-flow.md) — what changes when a project is claimed
- [Configuration Surface](configuration-surface.md) — declared issuer origins and the full config that the secret authenticates uploads of
- [Claim API](api/claim-api.yaml) — HTTP surface for project creation and secret lifecycle
- [`../api/credentials.md`](../api/credentials.md) — canonical credential taxonomy across the whole API
- [`../glossary.md`](../glossary.md) — vocabulary
