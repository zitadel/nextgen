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
its own `t.Cleanup` and `context.Background()`. Rows written into the platform
project and the catalog tables are the usual cases. A project created over HTTP
is another: the handler is cached for the whole run, so it holds the unwrapped
service, and the test calls `Harness.CleanupProject` for what it created.

## Errors

Services and storage return `domain.Error` values. Each carries a `Code`, and
`domain.Error` implements `Is` by code, so it matches through any wrapping.

Ask "is this that error?" with `errors.Is`:

```go
if errors.Is(err, domain.ErrAuthAttemptNotFound()) { ... }
```

Do not pull the error apart with `errors.As` and compare `e.Code` by hand for
that. Reach for `errors.As` only when you need a field from the error, and for a
code switch only where you map codes to statuses, as `errorResponse` does.

An error nobody classified is a fault on our side, so it ends up a 500.
`errorResponse` does this by default. Keep that property in any layer that
turns a service error into something else.

So when a layer turns a service error into a refusal (401, 403 and the like),
refuse only the errors that mean "no" and pass everything else on as internal:

```go
if errors.Is(err, domain.ErrTokenRevoked()) { // an answer that means "no"
    return ErrDenied
}
if errors.Is(err, domain.ErrInternal(nil)) {
    return err
}
return domain.ErrInternal(err) // we could not decide: the caller answers 500
```

Anything else means the layer could not decide, usually because a dependency
such as the database failed, so the credential was never judged. Reporting that
as a refusal tells clients their session is dead, and the SDKs clear their
cookie on a 401, so an outage would sign every user out. `introspectionFailure`
in `internal/api/security.go` follows this.

## Format before push

Before `git push` of Go changes under this tree, run
`moon run server:format`.

That task is check-only (`gofmt -l` on tracked `*.go`); it does not rewrite.
On failure, run `gofmt -w` on the listed paths, then re-run
`moon run server:format` until it passes. Do not push while it fails —
`server:format` is part of `ci / full-pr`.
