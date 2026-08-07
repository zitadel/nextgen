---
---

Speed up Go code generation from ~13.4s to ~3.1s.

`go generate ./...` ran all 31 directives serially, and the cost is per
invocation rather than per unit of work — mockgen type-loads a package before
it mocks anything, so a directive covering one interface costs the same ~800ms
as one covering twenty. Two changes:

- Each of `internal/{crypto,service,domain}` now has a single package-level
  mockgen directive in `generate.go` instead of one per interface file, so the
  package is type-loaded once. The generated mock and method surface is
  unchanged; the mocks land in one file per package.
- `moon run server:generate` and `server:check-generate` run packages
  concurrently via `scripts/go-generate.mjs`. `./api` runs alone first, because
  its generators parse `internal/domain` and `internal/service` source to
  discover error codes and must see those trees at rest.

Bare `go generate ./...` still produces identical output, just serially.
