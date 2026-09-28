---
"@zitadel/server": minor
---

`GET /flow-definitions` accepts `expand=user_schema` and embeds each flow definition's user schema on the entry, the same object `GET /schemas/{id}` returns, so a directory shows schema names from one request instead of one schema request per flow. The property is omitted when not requested and `null` when the referenced schema cannot be resolved or read; an unknown expand value is rejected with a 400. Expansion changes neither ordering nor page tokens.
