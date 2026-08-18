# Agent Instructions — `internal/`

These instructions apply to `internal/` and may be refined by nearer scoped
`AGENTS.md` files. Defer to root [`AGENTS.md`](../AGENTS.md) for repo-wide
rules.

## Format before push

Before `git push` of Go changes under this tree, run
`moon run server:format`.

That task is check-only (`gofmt -l` on tracked `*.go`); it does not rewrite.
On failure, run `gofmt -w` on the listed paths, then re-run
`moon run server:format` until it passes. Do not push while it fails —
`server:format` is part of `ci / full-pr`.
