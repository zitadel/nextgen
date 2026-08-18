# ADR 047: Dialect-Owned Identifier Generation

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
| SQLite | ULID | Same as Postgres: lexicographic time order keeps inserts near the B-tree right edge and avoids the page-split cost of random UUID v4 PKs on a local file DB |
| Spanner | UUID v4 | Spreads writes under `(project_id, id)` without bit-reversed ints |

All three expose the same Go surface: `idgen.Generator`, `idgen.Ensure`, and
`NewManagedID` on statements. SQL columns are `TEXT` / `STRING(MAX)` with
**no** identity or uuid default — the INSERT always supplies the PK. The
zero-config local default dialect is SQLite ([ADR 028](028-storage-v2-statements-and-dialects.md));
ID rules are identical zero-exception across dialects.

`Ensure` assigns when the ID pointer is empty. **Keep-any on non-empty IDs is
intentional**: ceremony / schema `$id` / fixtures may pre-mint via
`NewManagedID` and pass the value through create; “dialect owns minting” means
the dialect generator is the only mint path, not that create always overwrites.

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
| signing key | `sig_key` |
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
| authz assignment | `asgn` |
| event (audit wide-event) | `evt` |
| event sink | `sink` |

Existing style mix (`brnd` / `flowdef` / `enc_key` / `upw`) stays until a
dedicated rename PR. Do not add more without the selection rules below.

`att` collides with WebAuthn “attestation” jargon — known debt; do not rename
here.

### 3. Prefix selection rules (new prefixes only)

When adding a resource prefix:

1. Prefer **one segment** before the ID `_` (no `_` inside the prefix token).
   Existing multi-segment tokens (`enc_key`, `sig_key`) stay. Parse as
   registered prefix + `_` + opaque body using **longest-match against this
   registry** — never “split on the last `_`”.
2. Avoid auth / OIDC / WebAuthn jargon that means something else elsewhere
   (see `att` debt above).
3. Prefer readable forms for client-visible IDs; cryptic OK only for
   storage-only rows.
4. Public API resources: prefer the same token as the error-code resource
   where practical. Child credential rows may surface errors under a parent
   (`upw_*` → `user.*` is OK). Permission scopes follow the catalog name, not
   necessarily the ID abbrev.

### 4. HTTP create never accepts resource primary keys

Create bodies must not accept a client-chosen resource PK. OpenAPI documents
the forbid; handlers enforce it where ogen cannot (e.g. create-user).

### 5. Not resource PK generation

| Case | Rule |
|---|---|
| JSON Schema `$id` | Client URI when set; else dialect `sch_*` |
| SSO provider `id` in flow definitions | Config key, not a storage PK |
| Middleware `req_*` | Correlation only; local `RequestIDGenerator` |
| Secrets (`sk_*`, handoff, session token material) | Cryptographic secrets, not row PKs |

### 6. Pre-persist ceremony IDs

When an ID is needed before insert (provisional `user_*`, `pkreg_*`, in-memory
`flow_*` / `sess_*` handles), mint via dialect `NewManagedID` — same generator
as insert-time `Ensure`. Keep-any on create then preserves that value.

## Consequences

- One ownership story and one OpenAPI shape (prefixed opaque strings).
- Spanner, Postgres, and SQLite may diverge on opaque body (UUID vs ULID);
  clients must not assume Crockford ULID.
- `database.Identity` is a string pass-through for these columns (no int bind).
- Alpha migrations are rewritten in place; no dual-write of BIGINT PKs.
- Mint failures currently return raw `fmt.Errorf` from `idgen` /
  `NewManagedID` without dialect `wrapError`; fold into
  [ADR 030](030-error-model-mapping-and-reporting.md) storage-error work (no
  new public codes).
