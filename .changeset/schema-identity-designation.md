---
"@zitadel/server": minor
"@zitadel/config": minor
---

User schemas can now declare their identity: the schema-root `x-identifier` keyword names the one project-unique leaf property that identifies a user, and `x-display` lists the property paths rendering the display name. The server validates designations on inline schema uploads (URL-imported schemas are tracked separately in #812) — the named property must exist, be a leaf, and carry `x-unique: "project"` — and a schema that enables password authentication must designate an identifier, since password verification is unreachable without one. The shipped default human-user schema designates `email`.
