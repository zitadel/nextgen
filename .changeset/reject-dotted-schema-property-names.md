---
"@zitadel/server": minor
"@zitadel/config": minor
---

A user schema property name must be a single attribute name and may no longer
contain a dot. The rule lives in the user-schema meta-schema, so an editor
validating against the shipped dialect flags it while authoring, and the server
rejects it on create.
