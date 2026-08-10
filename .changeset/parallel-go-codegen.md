---
---

Speed up Go code generation from ~13.9s to ~3.5s, and add a way to prune
generated files that nothing generates any more.

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

New `moon run server:clean-generated` deletes every generated output, so
`clean-generated && generate` prunes orphans — whatever does not come back was
dead. Generators only ever write, so a file whose directive stopped producing
it (renamed destination, interface no longer mocked) previously stayed on disk
and stayed committed with nothing to flag it.

Making that usable meant fixing a latent bootstrap failure: generation could
not run against a tree with no generated files, because deleting
`internal/domain/*_enumer.go` stops the package type-checking and both enumer
and mockgen need to load it. The consolidated mockgen directives therefore live
in the mock subpackages (`internal/domain/mock`, `internal/service/mocks`,
`internal/crypto/mock`) rather than beside the interfaces, so `go generate
./...` reaches them only after the packages they mock are fully generated —
import-path order does the sequencing. The parallel runner ignores that order,
so it restates the same constraint as an explicit enumer-before-mockgen
barrier.

On the previous layout 20 files failed to regenerate from an empty tree; now
none do, by either path. `server:check-generate-pruned` keeps it that way.
