# Agent Instructions — `packages/go`

The public Go client module, `go.zitadel.com/zitadel/v5`.

- `api/*_gen.go` is ogen output of `apps/api/api/.ogen-client.yaml`; never
  hand-edit it, run `turbo run generate --filter=@zitadel/server`
  (`@zitadel/server#check-generate`).
- Keep this module free of the server: never require `github.com/zitadel/nextgen`;
  the server and `tools/bench` reach it through a `replace` to this directory.
- A type the spec names with `x-ogen-type` lives in `ogenx/`, because a
  public module cannot import the server's `internal/`.
- Keep `README.md`'s example and `api/example_test.go` the same in substance;
  `zitadel/v5#test` compiles and runs the Example.
- MIT, not AGPL ([LICENSING.md](../../LICENSING.md)).
- Change the `module` line together with the go-import page
  (`apps/cloud/go-import/public/index.html`); `TestVercelJSONServesGoImportMetadataOnGoHost` (`@zitadel/server#test`) fails on drift.
