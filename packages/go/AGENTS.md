# Agent Instructions — `packages/go`

The public Go client module, `go.zitadel.com/zitadel/v5`.

- `api/` is ogen output from `apps/api/api/openapi` through
  `apps/api/api/.ogen-client.yaml`; never hand-edit it, run
  `moon run server:generate`. `server:check-generate-pruned` fails on drift.
- Keep this module free of the server: it requires only what the generated
  client and `ogenx` need, never `github.com/zitadel/nextgen`. The server and
  `tools/bench` consume it through a `replace` to this directory.
- A type the spec names with `x-ogen-type` lives in `ogenx/`, because a
  public module cannot import the server's `internal/`.
- MIT, not AGPL ([LICENSING.md](../../LICENSING.md)).
