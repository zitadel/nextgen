# Agent Instructions — `internal/`

## Integration tests share one database

A Go integration test package (`internal/api/integration_test`,
`internal/storage/stmttest`) runs every test in one database, so rows a test
leaves behind slow every test after it. On the Spanner emulator the authz list
predicate's cost grows with the rows in its tables.

- Clean up what a test creates. Create fixtures under the test's own project:
  `helpers.Harness.EnsureProjectService` registers the delete, and the authz
  tables (`resource_scope_index`, `authz_assignments`,
  `authz_membership_edges`) cascade from `projects`.
- Clean up anything written outside the test's project (the platform
  project, the catalog tables) with the test's own `t.Cleanup` and
  `context.Background()`.
- A project created over HTTP goes through the cached handler's unwrapped
  service; remove it with `Harness.CleanupProject`.

## Errors

Services and storage return `domain.Error` values, which match by `Code`
through any wrapping.

- Ask "is this that error?" with `errors.Is`:
  `errors.Is(err, domain.ErrAuthAttemptNotFound())`. Use `errors.As` only to
  read a field, and switch on codes only where they map to statuses, as
  `errorResponse` (`internal/api/error_handler.go`) does.
- An error nobody classified is a server fault and ends as a 5xx; keep that
  in every layer that turns a service error into something else.
- A layer that turns errors into refusals (401, 403) refuses only the errors
  that mean "no" and passes every server fault through, so it keeps its own
  5xx (`domain.IsServerFault`, as `errorResponse` reads it):

  ```go
  if errors.Is(err, domain.ErrTokenRevoked()) { // an answer that means "no"
      return ErrDenied
  }
  if domain.IsServerFault(err) { // 500, 501 or 503, decided by errorResponse
      return err
  }
  return domain.ErrInternal(err) // anything else: we could not decide
  ```

- A refusal for an error that means "we could not decide" (the database
  failed, say) tells clients their session is dead, and the SDKs clear their
  cookie on a 401: an outage would sign every user out.
- A handler a browser lands on, outside the API, answers a failure with
  `internal/errorpage`, never HTML of its own; an API path answers the
  envelope even to a browser ([ADR 076](../docs/adrs/076-error-pages-and-unmatched-routes.md)).
- A handler or route that answers 400 or above without returning the error to
  ogen records it with `middleware.RecordError`; the integration run fails on
  an answer with none.

## Format before push

Run `moon run server:format` before pushing Go changes. It only checks
(`gofmt -l` on tracked `*.go`); on failure run `gofmt -w` on the listed paths
and re-run it. `server:format` is part of `ci / full-pr`.

## Redirect targets

A URL the server sends a browser to, or stores to send one to later, comes
from a caller until proven otherwise.

- Parse it with `httputil.ParseRedirectTarget` and nothing else, never
  `url.Parse` plus checks by hand: a browser and a Go parser read the same
  string differently (a backslash is a slash, `%2e` a dot, a tab is dropped,
  a leading `//` names another host), and an open redirect lives in that gap.
- The function decides whether the URL is safe for a browser; the caller
  still decides which hosts it accepts (for example, the request's origin).
- A new way around the check goes into
  `internal/httputil/testdata/redirect_targets.json`, and the fix into the
  function and into the API mock's port (`packages/api-mock/src/redirect-target.ts`),
  which reads the same file. Never add a second check at the call site.
