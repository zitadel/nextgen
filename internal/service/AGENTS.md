# Agent Instructions — `internal/service/`

These instructions apply to `internal/service/`. Defer to
[`internal/AGENTS.md`](../AGENTS.md) (format before push) and root
[`AGENTS.md`](../../AGENTS.md) for broader rules.

## Events stay in sync with mutations

Service mutate paths (create, update, delete, state flips, factor and authz
writes) own Path B emitters: `audit.Emit` in the same transaction as the
write. Adding, changing, or removing a mutation **must** keep events current
— including **adding** a type when a new semantic mutation appears, and
**removing** a type that no longer has a producer.

A change is incomplete if it:

- adds a mutate without an emit,
- changes a payload so it no longer matches the catalog, or
- removes a mutate but leaves a live catalog type, `EventType` constant, or
  OpenAPI event member.

Authority (do not duplicate payload rules or the catalog table here):

- Catalog: [`docs/design/api/events-catalog.md`](../../docs/design/api/events-catalog.md)
  (payload rules, live Path B table, deferred list). Context:
  [ADR 048](../../docs/adrs/048-wide-events-internal-audit-primitive.md),
  [ADR 049](../../docs/adrs/049-events-api-retention-export.md).
- Types: [`internal/domain/event.go`](../domain/event.go) `EventType`
  constants.
- Payloads: [`internal/domain/event_payload.go`](../domain/event_payload.go).
- OpenAPI: payload YAML under
  `api/openapi/endpoints/events/payloads/` plus the map in
  [`api/cmd/gen_event_schemas/main.go`](../../api/cmd/gen_event_schemas/main.go);
  regenerate with `moon run server:generate` or `go generate ./api/`.
- Producer allowlist:
  [`internal/audit/catalog_producers_test.go`](../audit/catalog_producers_test.go)
  — live catalog types must have a producer; do not list deferred types as
  live.
