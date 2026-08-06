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

#### Generate server

```shell
go tool ogen --target ../generated --clean openapi-spec.yaml
```

or using `go generate`

```shell
go generate ./...
```

## API Design Conventions

### Pagination

This API uses **cursor-based pagination** (`page_token` / `next_page_token`), not offset-based.

- Request the next page by passing `next_page_token` from the previous response back as `page_token`.
- Omit `page_token` to start from the beginning.
- Treat `page_token` as opaque — do not attempt to decode or construct it.

> **Note:** Some endpoints (e.g. `GET /users`) currently still use `offset`/`limit`.
> These are marked with a `TODO` comment and will be migrated to `page_token` / `next_page_token`.
> New list endpoints must use cursor-based pagination — see `POST /sessions/query` as the reference implementation.

### Nullable types

OpenAPI 3.1 / JSON Schema 2020-12 expresses nullable fields using an array type:

```yaml
# Spec-correct OpenAPI 3.1
session_id:
  type: ["string", "null"]
```

However, ogen v1.20.3 parses the `type` field as a plain string and cannot unmarshal
a YAML sequence, causing generation to fail with `cannot unmarshal !!seq into string`.
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

### Spec merging: Redocly

- Github: [](https://github.com/Redocly/redocly-cli)
- Docs: [](https://redocly.com/docs/cli)

#### Install Redocly

```shell
npm install -g @redocly/cli
```

or docker

```shell
docker pull redocly/cli
```

#### Merge spec

```shell
redocly bundle open-api-spec.yaml -o bundled.yaml 
```

or docker

```shell
docker run --rm -v $PWD:/spec redocly/cli bundle open-api-spec.yaml -o bundled.yaml 
```
