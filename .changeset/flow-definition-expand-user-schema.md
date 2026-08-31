---
"@zitadel/server": minor
---

`GET /flow-definitions` accepts `expand=user_schema` (ADR 059) and embeds each flow definition's user schema as `user_schema` on the entry, the same object `GET /schemas/{id}` returns, so a directory renders names without one schema request per flow. The property is omitted entirely when not requested and `null` when the referenced schema cannot be resolved or read; an unknown expand value is a 400. Expansion never widens schema access and never affects ordering or page tokens.
