# ADR 012: Ephemeral Identifier API Representation

> **Status:** Proposed  
> **Date:** 2026-05-15  
> **Context:** HTTP/OpenAPI surface for nextgen  
> **Depends on:** [ADR 011](011-resource-identifiers.md)

## Context

[ADR 011](011-resource-identifiers.md) stores ephemeral resource identifiers as database-generated integers and represents them in Go as decimal strings via `database.Identity`. OpenAPI today still documents prefixed string patterns (for example `sess_…`, `att_…`) that do not match storage.

Before exposing ephemeral ids on public endpoints, we must decide how integers appear in JSON, path parameters, and agent-facing CLI output.

## Decision

**Deferred.** No API or OpenAPI change is made in the ADR 011 implementation window.

Candidates to evaluate in a future revision of this ADR:

| Approach | Notes |
|----------|--------|
| Decimal string | Simple mapping to `database.Identity`; breaks existing `sess_` / `att_` patterns |
| Prefixed encoding | Preserve opaque `sess_` / `att_` UX with a defined encode/decode to the stored integer |
| Opaque token | Separate external token column; storage integer remains internal-only |

## Consequences

- Storage and repository work may proceed under ADR 011 without blocking on API design.
- Generated OpenAPI types and console/SDK contracts remain unchanged until this ADR is accepted.
