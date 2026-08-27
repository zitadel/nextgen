---
"@zitadel/server": minor
---

Login flows resolve the identifier from the schema's designation: a flow field carries the identifier challenge only when it names the schema-root `x-identifier` property. Other unique properties keep their uniqueness for storage but are no longer treated as login identifiers.
