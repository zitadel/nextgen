# OpenApi spec

This directory contains the full open api spec of Zitadel NextGen. The spec
uses OpenApi v3.1 which allows for a multifile specification. This is easier
to maintain but brings some hurdles for tooling. Many preview tools don't
lint/render it properly. This document gives provides guidelines/tools to
make development smoother.

## Tooling

### Editing: VS-Code

Goland does not handle multi file specs well.

Extensions:

- Linter: Redocly OpenAPI
- Preview: Scalar OpenAPI Preview

### Code generation: Ogen

- Github: [](https://github.com/ogen-go/ogen)
- Docs: [](https://ogen.dev/docs/intro)

#### Install Ogen

Ogen is tracked as a [Go tool dependency](https://go.dev/blog/tools) in `go.mod`.
It is installed automatically when running `go tool ogen` or `go generate`.

#### Generate the server stubs and the client

```shell
turbo run generate --filter=@zitadel/server
```

It runs every directive of `apps/api/api/generate.go`: the server stubs into
`apps/api/internal/api/generated` (`.ogen.yaml`) and the public client into
`packages/go/api` (`.ogen-client.yaml`), after the error and event schemas
they depend on.

## API Design Conventions

### Pagination

This API uses **cursor-based pagination** (`page_token` / `next_page_token`), not offset-based.

- Request the next page by passing `next_page_token` from the previous response back as `page_token`.
- Omit `page_token` to start from the beginning.
- Treat `page_token` as opaque — do not attempt to decode or construct it.

New list endpoints must use cursor-based pagination — see `POST /sessions/query` as the reference implementation.

### Nullable types

OpenAPI 3.1 / JSON Schema 2020-12 expresses nullable fields using an array type:

```yaml
# Spec-correct OpenAPI 3.1
session_id:
  type: ["string", "null"]
```

However, ogen (the pinned Go tool dependency in `go.mod`) parses the `type` field
as a plain string and cannot unmarshal a YAML sequence, causing generation to fail
with `cannot unmarshal !!seq into string`.
This is tracked upstream at [ogen-go/ogen#1617](https://github.com/ogen-go/ogen/issues/1617).

**Workaround:** Use `oneOf` with an explicit `null` type instead, which is still
OpenAPI 3.1 / JSON Schema compliant and ogen handles correctly:

```yaml
# OpenAPI 3.1 compliant, ogen-compatible workaround
session_id:
  oneOf:
    - type: string
    - type: 'null'
```

Once ogen#1617 is resolved, all `oneOf` nullable patterns in this spec can be
migrated to the more concise `type: ["string", "null"]` form.

### Linting and bundling: Redocly

The repo pins `@redocly/openapi-core` (the library behind the
[Redocly CLI](https://redocly.com/docs/cli)) and applies `redocly.yaml` and
`.redocly.lint-ignore.yaml` from the repo root. Nothing needs installing:

```shell
turbo run lint --filter=@zitadel/server       # lint openapi-spec.yaml, among the server's checks
turbo run generate --filter=@zitadel/server   # also writes bundled/openapi.json (MountAPI serves it)
turbo run generate --filter=@zitadel/docs     # bundle it into apps/docs/.generated/openapi.mjs
```

`scripts/bundle-openapi.mjs` (via `go generate` / the server's `generate`) writes the
committed `bundled/openapi.json` the Go server embeds (served at
`{PathPrefix}/openapi.json`). Docs `generate` shapes that same file into
`.generated/openapi.mjs`. CI's `@zitadel/server#check-generate` fails when the
JSON drifts from the YAML sources.
