---
"@zitadel/server": minor
"@zitadel/config": minor
---

A user schema property name must be a single attribute name and cannot contain
a dot. The rule lives in the user-schema meta-schema and its OpenAPI mirror, so
an editor validating against the shipped dialect flags it while authoring, and
the server rejects it on create.

Nested properties are validated as properties: each is an object describing one
attribute, with its annotations checked. Generated clients type a user
property's nested `properties` map as a map of user properties.
