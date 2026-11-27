# Agent Instructions — `internal/service/`

The rules in [`internal/AGENTS.md`](../AGENTS.md) apply here too.

## Events stay in sync with mutations

Service mutate paths (create, update, delete, state flips, factor and authz
writes) own Path B emitters: `audit.Emit` in the same transaction as the
write. Adding, changing, or removing a mutation **must** keep events current
— including **adding** a type when a new semantic mutation appears, and
**removing** a type that no longer has a producer, unless rows were ever
stored under it, in which case it moves to the catalog's Retired table.

A change is incomplete if it:

- adds a mutate without an emit,
- changes a payload so it no longer matches the catalog, or
- removes a mutate but leaves the type in the live Path B table. A type
  that has stored rows moves to Retired and keeps its `EventType` constant
  and OpenAPI member so those rows still decode, until its rows have aged
  out of retention, when the type is removed.

Authority (do not duplicate payload rules or the catalog table here):

- Catalog: [`docs/design/api/events-catalog.md`](../../../../docs/design/api/events-catalog.md)
  (payload rules, live Path B table, Retired table, deferred list). Context:
  [ADR 048](../../../../docs/adrs/048-wide-events-internal-audit-primitive.md),
  [ADR 049](../../../../docs/adrs/049-events-api-retention-export.md).
- Types: [`internal/domain/event.go`](../domain/event.go) `EventType`
  constants.
- Payloads: [`internal/domain/event_payload.go`](../domain/event_payload.go).
- OpenAPI: payload YAML under `api/openapi/endpoints/events/payloads/`, the
  type's entries in `payloadByEventType` and `webhookByEventType`
  ([`api/cmd/gen_event_schemas/main.go`](../../api/cmd/gen_event_schemas/main.go)),
  and its webhook in the root `webhooks:` list of
  [`api/openapi/openapi-spec.yaml`](../../api/openapi/openapi-spec.yaml),
  which the generator checks. Regenerate with `turbo run generate --filter=@zitadel/server`.
- Producer allowlist:
  [`internal/audit/catalog_producers_test.go`](../audit/catalog_producers_test.go)
  — live catalog types must have a producer; do not list deferred types as
  live.

## A carrier hands on its chain

An event's `correlation_id` and `flow_id` come from the request's
`middleware.Correlation`, never from an emitter
([ADR 048](../../../../docs/adrs/048-wide-events-internal-audit-primitive.md#amendment-2026-11-26-a-correlation-id-that-requests-inherit)).

- A mutate that loads a carrier it acts on (an authorization request, a flow
  state, an auth attempt, an invitation, a claim challenge) calls
  `audit.JoinCorrelation` with the carrier's chain before its first emit.
- A mutate that creates a carrier stores `audit.EnsureCorrelation(ctx)` on it.
- Never join from a list, and never store a chain on a session or a token:
  a chain ends with the events that create those.
- A feature that takes several requests names its carrier in the ADR's table
  and the catalog's, and stores the chain in a column of its own.

## The events list reads no further than a page or a budget

- Put a new `GET /events` filter into `planEventRead` (`event.go`): as part of
  an index range, or as `match`. Never add it to a list's WHERE on its own.
- A filter that must always fill its pages needs an index ending in
  `(created_at, id)` on all three dialects, pinned in `TestListEvents_FilterPlans`.

## Background jobs

- `JobStatements` is storage-only on `AllStatements`. The shared `jobs.Engine`
  owns `RegisterWorker`, poll / `RunDueOnce`, and Take/Complete txs
  ([ADR 065](../../../../docs/adrs/065-background-jobs.md)).
- Product code Enqueues inside the caller’s write transaction. Boot calls
  `SetPeriodic` from server config. Handlers that emit Path B use the system
  actor. Guide: [`docs/design/jobs/`](../../../../docs/design/jobs/README.md).
