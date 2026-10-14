---
"@zitadel/server": minor
---

The API contract names a flow definition's `user_schema` by the schema's `objectType`, resolved to the project's newest revision of that schema. A schema id is still accepted on write and is stored as its `objectType`. The server does not store the `objectType` yet.
