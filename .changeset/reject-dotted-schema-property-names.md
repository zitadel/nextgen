---
"@zitadel/server": minor
"@zitadel/config": minor
---

A user schema property name must be a single attribute name and may no longer
contain a dot. The rule lives in the user-schema meta-schema, so an editor
validating against the shipped dialect flags it while authoring, and the server
rejects it on create.

Nested properties are now validated the same way top-level ones already were.
A nested property must be an object describing one attribute, and its
annotations are checked — `x-unique: "projekt"` on a nested leaf used to be
accepted and silently leave the value non-unique, and is now rejected. Two
consequences for schemas that were accepted before: a boolean subschema
(`"foo": true`) is no longer allowed below the first level, and an annotation
with the wrong type or an unknown value now fails wherever it appears.
