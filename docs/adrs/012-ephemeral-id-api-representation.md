# ADR 012: Ephemeral Identifier API Representation

> **Status:** Accepted  
> **Date:** 2026-05-20  
> **Context:** HTTP/OpenAPI surface for nextgen  
> **Depends on:** [ADR 011](011-resource-identifiers.md)

## Context

[ADR 011](011-resource-identifiers.md) stores ephemeral resource identifiers as database-generated integers and represents them in Go as decimal strings via `database.Identity`. Previous OpenAPI drafts documented prefixed string patterns (for example `sess_…`, `att_…`) that did not match storage behavior.

Before exposing ephemeral ids on public endpoints, we must decide how integers appear in JSON, path parameters, and agent-facing CLI output.

## Decision

Ephemeral identifiers are represented externally without resource-type prefixes.

- `session_id`, `attempt_id`, and `challenge_id` no longer carry `sess_`, `att_`, `chal_`, or similar prefixes.
- API clients must treat these identifiers as opaque strings.
- The current server implementation maps these IDs directly from `database.Identity` (decimal string representation).

## Consequences

- OpenAPI schemas and examples for `session_id`, `attempt_id`, and `challenge_id` must not imply prefixed formats.
- Existing clients that validated or generated prefixed ephemeral IDs must be updated.
- Storage and repository behavior remains aligned with ADR 011 and requires no additional identifier encoding layer.
