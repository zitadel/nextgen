# ADR 012: Ephemeral Identifier API Representation

> **Status:** Accepted  
> **Date:** 2026-05-20  
> **Updated:** 2026-08-03  
> **Context:** HTTP/OpenAPI surface for nextgen  
> **Depends on:** [ADR 011](011-resource-identifiers.md), [ADR 047](047-dialect-id-generation.md)

## Context

[ADR 011](011-resource-identifiers.md) / [ADR 047](047-dialect-id-generation.md)
store **all** resource primary keys as dialect-minted prefixed opaque strings.
“Ephemeral” resources (sessions, auth attempts, checks) still have short
lifetimes, but their IDs use the same prefix rule as durable resources.

Earlier text of this ADR required **unprefixed** decimal strings for ephemeral
API fields. That matched BIGINT identity storage and is superseded.

## Decision

Ephemeral resource identifiers on the API **are** prefixed opaque strings:

- `session_id` → `sess_…`
- `attempt_id` → `att_…`
- `challenge_id` / check id → `ch_…`
- token row ids → `tkn_…`

Clients must treat them as opaque (do not parse ULID vs UUID). OpenAPI schemas
document the required prefix. Secrets (session token material, handoff tokens)
remain separate from row PKs.

## Consequences

- OpenAPI examples and patterns use the domain prefixes.
- Mocks and fixtures should mint prefixed ids.
- No separate decimal encoding layer for ephemeral ids.
