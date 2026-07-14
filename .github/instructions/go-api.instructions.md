---
applyTo: "**/*.go,go.mod,go.sum,api/openapi/**/*.yaml"
---

# Go And API Review Instructions

The Go server is pre-release and currently uses Go 1.26. The OpenAPI source is
multi-file OpenAPI 3.1 under `api/openapi/`; generated server code lives under
`api/generated/`.

- Review Go changes for `gofmt`, `go vet ./...`, and `go test ./...`.
- Do not hand-edit `api/generated/**`; update `api/openapi/**` and regenerate
  with `moon run server:generate` or `go generate ./...`. CI enforces drift
  through `server:check-generate`.
- Keep OpenAPI operation, schema, and security changes compatible with ogen and
  the generated handler interfaces.
- Preserve clear boundaries between public API contracts in `api/` and server
  implementation in `internal/`.
- Watch licensing: server implementation is AGPL-3.0-only by default, while
  `api/` is an MIT exception per `LICENSING.md`.
