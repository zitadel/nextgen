---
applyTo: "**/*.go,go.mod,go.sum,api/openapi/**/*.yaml"
---

# Go And API Review Instructions

The Go server is pre-release; the Go version comes from `go.mod`. Canonical
scoped sources for this glob:
[`internal/storage/AGENTS.md`](../../internal/storage/AGENTS.md) (statements,
transactions, identifier minting, authz persistence, `stmttest` contract
tests) and [`api/openapi/AGENTS.md`](../../api/openapi/AGENTS.md) (wire
snake_case gate, error-code catalog, pagination). Review pointers on top:

- Review Go changes for `gofmt`, `go vet ./...`, and `go test ./...`.
- Do not hand-edit `api/generated/**`; update `api/openapi/**` and regenerate
  with `moon run server:generate`. CI enforces drift through
  `server:check-generate`, and wire casing through
  `workspace:check-openapi-rules` — wrong casing fails silently at runtime,
  so treat those gates as part of the contract.
- Error responses follow the stable code catalog
  ([ADR 030](../../docs/adrs/030-error-model-mapping-and-reporting.md),
  [`error-details-producers.md`](../../docs/design/api/error-details-producers.md));
  new endpoints must not invent ad-hoc error shapes.
- Preserve clear boundaries between public API contracts in `api/` and server
  implementation in `internal/`.
- Watch licensing: server implementation is AGPL-3.0-only by default, while
  `api/` is an MIT exception per [`LICENSING.md`](../../LICENSING.md).
