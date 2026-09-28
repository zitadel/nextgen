---
"@zitadel/server": minor
"@zitadel/cli": patch
---

`GET /schemas` and `GET /schemas/{id}` now return each schema as an `{id, schema, metadata}` envelope carrying the full customer-authored document, and `GET /schemas` wraps its rows in a `{schemas: [...]}` object. The two read endpoints share one representation; the resource `id` and `metadata.created_at` are server-owned and can no longer collide with keys in the document. Clients that read the bare document from `GET /schemas/{id}` or the bare `{id, created_at}` array from `GET /schemas` must unwrap the envelope.
