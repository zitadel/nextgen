# ADR 046: Dialect-Owned Identifier Generation

> **Status:** Accepted
> **Date:** 2026-07-30
> **Updated:** 2026-08-03
> **Context:** Completing storage-owned ID generation (ADR 028 §8)
> **Amends:** [ADR 011](011-resource-identifiers.md) (single ID class),
> [ADR 012](012-ephemeral-id-api-representation.md) (prefixed API ids);
> completes the open checklist item in [ADR 028](028-storage-v2-statements-and-dialects.md)

## Context

Every durable and ephemeral resource row needs a primary key that is:

- owned by the storage dialect (not domain, not the HTTP client, not SQL `DEFAULT` / `IDENTITY`);
- typed by a short prefix (`user_`, `sess_`, `att_`, …);
- opaque to API clients.

Earlier drafts split “ephemeral = DB integer” and “managed = prefixed ULID”. That
forced two Go bind paths, ADR 012’s unprefixed decimal strings, and Spanner
`BIT_REVERSED` identity. Alpha allows one breaking rule: **zero exceptions**.

## Decision

### 1. One ID class: dialect-minted `prefix_<opaque>`

| Dialect | Opaque body | Why |
|---|---|---|
| PostgreSQL | ULID | Time-sortable; fine under hash / `(project_id, id)` keys |
| Spanner | UUID v4 | Spreads writes under `(project_id, id)` without bit-reversed ints |

Both expose the same Go surface: `idgen.Generator`, `idgen.Ensure` (assign if
empty; keep non-empty for ceremony / schema `$id` / fixtures), and
`NewManagedID` on statements. SQL columns are `TEXT` / `STRING(MAX)` with
**no** identity or uuid default — the INSERT always supplies the PK.

### 2. Prefix registry (domain constants)

| Resource | Prefix |
|---|---|
| project | `proj` |
| team | `team` |
| user | `user` |
| branding | `brnd` |
| flow definition | `flowdef` |
| flow handle (in-memory) | `flow` |
| JSON schema (when server-assigned) | `sch` |
| encryption key | `enc_key` |
| signing key | (domain constant) |
| passkey registration | `pkreg` |
| session | `sess` |
| auth attempt | `att` |
| check / challenge | `ch` |
| token row | `tkn` |
| user agent | `ua` |
| user password row | `upw` |
| user TOTP row | `utotp` |
| user recovery codes row | `urc` |
| user passkey row | `upk` |

### 3. HTTP create never accepts resource primary keys

Create bodies must not accept a client-chosen resource PK. OpenAPI documents
the forbid; handlers enforce it where ogen cannot (e.g. create-user).

### 4. Not resource PK generation

| Case | Rule |
|---|---|
| JSON Schema `$id` | Client URI when set; else dialect `sch_*` |
| SSO provider `id` in flow definitions | Config key, not a storage PK |
| Middleware `req_*` | Correlation only; local `RequestIDGenerator` |
| Secrets (`sk_*`, handoff, session token material) | Cryptographic secrets, not row PKs |

### 5. Pre-persist ceremony IDs

When an ID is needed before insert (provisional `user_*`, `pkreg_*`, in-memory
`flow_*` / `sess_*` handles), mint via dialect `NewManagedID` — same generator
as insert-time `Ensure`.

## Consequences

- One ownership story and one OpenAPI shape (prefixed opaque strings).
- Spanner and Postgres may diverge on opaque body (UUID vs ULID); clients must
  not assume Crockford ULID.
- `database.Identity` is a string pass-through for these columns (no int bind).
- Alpha migrations are rewritten in place; no dual-write of BIGINT PKs.
