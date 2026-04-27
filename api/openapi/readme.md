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
