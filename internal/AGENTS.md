# Agent Instructions — `internal/`

These instructions apply to `internal/` and may be refined by nearer scoped
`AGENTS.md` files. Defer to root [`AGENTS.md`](../AGENTS.md) for repo-wide
rules.

## Integration tests share one database

A Go integration test package (`internal/api/integration_test`,
`internal/storage/stmttest`) brings up one database and runs every test in it.
Rows a test leaves behind are paid for by every test that runs after it.

That cost is real, not theoretical. The authz list predicate is a correlated
`EXISTS`, and on the Spanner emulator its cost grows with the rows in the
tables: reading lists against everything the package had accumulated took one
test to 687.9s of a 727.8s package.

So a test cleans up what it creates. The cheapest way to get that is to create
every fixture under the test's own project, because
`helpers.Harness.EnsureProjectService` registers the delete for you and the
authz tables (`resource_scope_index`, `authz_assignments`,
`authz_membership_edges`) cascade from `projects`.

Anything a test writes outside its own project it has to clean up itself, with
its own `t.Cleanup` and `context.Background()`. The platform project and the
catalog tables are the cases that come up.

## Format before push

Before `git push` of Go changes under this tree, run
`moon run server:format`.

That task is check-only (`gofmt -l` on tracked `*.go`); it does not rewrite.
On failure, run `gofmt -w` on the listed paths, then re-run
`moon run server:format` until it passes. Do not push while it fails —
`server:format` is part of `ci / full-pr`.
