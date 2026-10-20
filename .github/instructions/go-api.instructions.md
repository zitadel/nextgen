---
applyTo: "**/*.go,go.mod,go.sum,api/openapi/**/*.yaml"
---

# Go And API Review Instructions

Canonical scoped sources for this glob:
[`internal/AGENTS.md`](../../internal/AGENTS.md),
[`internal/storage/AGENTS.md`](../../internal/storage/AGENTS.md) and
[`api/openapi/AGENTS.md`](../../api/openapi/AGENTS.md). Review heuristics on
top:

- Never ask an author to hand-edit `api/generated/**`; the fix goes into
  `api/openapi/**` and `moon run server:generate`. CI checks drift with
  `server:check-generate-pruned` and lints the spec, wire casing included,
  with `server:openapi`. Wrong casing fails silently at runtime, so treat both
  gates as part of the contract.
- Error responses follow the stable code catalog
  ([ADR 030](../../docs/adrs/030-error-model-mapping-and-reporting.md),
  [`error-details-producers.md`](../../docs/design/api/error-details-producers.md));
  flag a new endpoint that invents an ad-hoc error shape.
- Keep the public API contract in `api/` apart from the server implementation
  in `internal/`: they sit on opposite sides of the licensing split in
  [`LICENSING.md`](../../LICENSING.md).
