---
applyTo: "**/*.go,**/go.mod,**/go.sum,apps/api/api/openapi/**/*.yaml"
---

# Go And API Review Instructions

Canonical scoped sources for this glob:
[`apps/api/internal/AGENTS.md`](../../apps/api/internal/AGENTS.md),
[`apps/api/internal/storage/AGENTS.md`](../../apps/api/internal/storage/AGENTS.md) and
[`apps/api/api/openapi/AGENTS.md`](../../apps/api/api/openapi/AGENTS.md). Review heuristics on
top:

- Never ask an author to hand-edit `apps/api/internal/api/generated/**`; the fix goes into
  `apps/api/api/openapi/**` and `moon run server:generate`. CI checks drift with
  `server:check-generate-pruned` and lints the spec, wire casing included,
  with `server:openapi`. Wrong casing fails silently at runtime, so treat both
  gates as part of the contract.
- Error responses follow the stable code catalog
  ([ADR 030](../../docs/adrs/030-error-model-mapping-and-reporting.md),
  [`error-details-producers.md`](../../docs/design/api/error-details-producers.md));
  flag a new endpoint that invents an ad-hoc error shape.
- Keep the public API contract in `apps/api/api/` apart from the server
  implementation in `apps/api/internal/`: they sit on opposite sides of the
  licensing split in
  [`LICENSING.md`](../../LICENSING.md).
