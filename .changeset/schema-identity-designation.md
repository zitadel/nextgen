---
"@zitadel/server": minor
"@zitadel/config": minor
---

User schemas can now declare their identity: the schema-root `x-identifier` keyword names the leaf property whose value identifies a user, and `x-display` lists the property paths that render the display name. Inline schema uploads validate the designations — every designated property must exist and declare a scalar type, the identifier must additionally be unique within the project, and a schema that enables password authentication must designate an identifier, since password verification is unreachable without one. The shipped default human-user schema designates `email`.
