---
"@zitadel/server": minor
"@zitadel/api": minor
---

`POST /schemas` answers with the schema it stored, `{ id, schema, metadata }`,
as `GET /schemas/{schema_id}` returns it, so a caller no longer needs a second
read to see what was published
([API reference](https://preview.zitadel.com/docs/reference/api/schemas/publishSchema)).
The answer was `{ id }` alone; `id` is unchanged.

**Breaking:** in the Go client, `PublishSchema` returns `*Schema`, and
`CreateSchemaResponse` is gone: read `ID` from the `Schema`. In `@zitadel/api`,
`PublishSchema201` gains the required `schema` and `metadata`, so code that
builds one, such as a test double, must supply them.
