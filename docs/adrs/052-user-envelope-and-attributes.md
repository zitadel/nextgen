# ADR 052: User Envelope and Attributes

> **Status:** Proposed
> **Date:** 2026-08-17
> **Context:** `GET /users`, `POST /users`, user schema validation
>
> **Amends** [ADR 009](009-user-json-schema-validation.md) — the API property is
> `schema`, not `$schema` — and [ADR 020](020-credentials-out-of-user-schema.md)
> — the user schema describes `attributes`, not the whole response body.

## Decision

A user is a server-owned envelope with the schema-defined content nested inside
it:

```json
{
  "id": "user_01KZZY8PX8K8ATNVDSMRCZY4N1",
  "schema": "sch_01KZZY705G04CPPG0QGZM9ERF2",
  "attributes": { "email": "vitor@zitadel.com", "givenName": "Vitor" },
  "metadata": { "created_at": "2026-08-14T10:49:43Z", "status": "active" }
}
```

- `attributes` is the document the user schema validates. Nothing else is.
- `id`, `schema` and `metadata` are the envelope, owned by the server.
- The schema pointer is `schema`. The `$` prefix is dropped.

## Context

A flat user put the envelope and the schema-defined content in one namespace,
which cost three things:

- `id` and `metadata` could not be used as schema property names.
- Validation ran against the whole body, so `additionalProperties: false`,
  `propertyNames` and `unevaluatedProperties` rejected every write.
- The schema pointer was stored twice — as `users.schema_url` and as an
  attribute row — and emitted twice on the wire.

Nesting resolves all three. The `$` prefix goes because no `$`-prefixed
property survives the TypeScript codegen.

## Consequences

- The create request is its own schema and rejects unknown top-level
  properties, so [ADR 047](047-dialect-id-generation.md) §4's forbid on
  client-chosen primary keys is enforced by the contract rather than by the
  handler.
- Create and read return the same representation.
- A user schema may declare a property named `id` or `metadata`.

## Open question

`schema` is typed `string`, not `format: uri`. ADR 009 §1 describes the value as
a URL, and a schema's storage identity is its URL (`json_schemas` is keyed
`(project_id, url)`), but `/schemas` returns that same value under the name `id`
and mints it as `sch_…`. Whether the wire form is a URL, an opaque id, or both
is unresolved.
