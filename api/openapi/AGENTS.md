# Agent Instructions — `api/openapi`

Scoped instructions for the OpenAPI 3.1 sources — the contract of record for
the HTTP API. Defer to root [`AGENTS.md`](../../AGENTS.md) for repo-wide rules.
Tooling mechanics (multi-file layout, bundling, the ogen `oneOf`-null
workaround, pagination rules) live in [`readme.md`](readme.md) — read it
before restructuring spec files.

## The generate loop

`api/generated/` is ogen output — never hand-edit it. Change the spec here,
then run `moon run server:generate` (or `go generate ./...`); CI enforces
committed generated output via `server:check-generate`. The TypeScript client
in `packages/api/src/generated/` regenerates from the same source.

## Wire casing — snake_case, gated

Wire fields, enum values, and parameters are `snake_case`. **Wrong casing
fails silently at runtime**: an unknown property is dropped, not rejected —
which is why lint gates exist instead of trusting review:

- `rule/wire-field-snake-case`, `rule/wire-enum-no-camel-case`, and
  `rule/wire-parameter-no-camel-case` in [`redocly.yaml`](../../redocly.yaml)
  (with documented carve-outs: JSON Schema keywords, `x-` extensions, RFC
  vocabularies like `S256`, header/cookie parameter names).
- `moon run workspace:check-openapi-rules` runs fixture tests
  (`scripts/openapi-casing-rules.test.mjs`) that fail if the redocly rule
  config itself silently stops matching — keep the fixtures in sync when
  touching the rules.

## Error codes — stable, generated catalog

Errors are `{ code, message, details? }` per
[`components/error-details.yaml`](components/error-details.yaml). Codes are
stable, machine-readable, and dot-namespaced (`att.invalid_proof`); the
per-endpoint catalog under `components/schemas/errors/` is **generated**
(`gen_error_schemas` — do not hand-edit those files). Clients branch on
`code`. The taxonomy and producer contract are
[ADR 030](../../docs/adrs/030-error-model-mapping-and-reporting.md) and
[`error-details-producers.md`](../../docs/design/api/error-details-producers.md).

## Pagination and list queries

Cursor-based only for new endpoints (`page_token` / `next_page_token`,
`limit` default 20 max 100); list queries are `POST /<resource>/query` with
structured `filter`/`sorting` bodies
([ADR 027](../../docs/adrs/027-cursor-based-pagination.md),
[ADR 031](../../docs/adrs/031-openapi-querying.md)). `POST /sessions/query`
is the reference implementation; the canonical how-to is in
[`readme.md`](readme.md#api-design-conventions).

## Identifiers on the wire

Resource ids are prefixed opaque strings (`user_01H…`, `proj_01H…`,
[ADR 047](../../docs/adrs/047-dialect-id-generation.md)); ephemeral ids follow
[ADR 012](../../docs/adrs/012-ephemeral-id-api-representation.md). Use the
prefixed form in `example:` fields — the retired dictionary-slug form
(`river-8421`) must not reappear.
