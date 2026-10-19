---
"@zitadel/server": patch
"@zitadel/config": patch
"@zitadel/cli": patch
---

Built-in schemas are now named under `https://preview.zitadel.com/schemas/v1`, for example `https://preview.zitadel.com/schemas/v1/user-schema.json`, instead of `https://nextgen.com/api/schemas`, a domain Zitadel does not own. Existing projects need no change: a built-in schema's id resolves under either base everywhere the API reads one, including `GET /schemas/{id}`, a flow definition's `user_schema`, a release's schema pointer, the users list's `schema` filter, and bootstrap user documents, and the server never fetches a URL in either namespace. A server still configured with the previous base accepts the new ids too. Projects created by `zitadel setup` from now on reference the new URLs, so pair this CLI with a server from this release or later.
