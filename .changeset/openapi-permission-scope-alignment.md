---
"@zitadel/server": minor
---

Align OpenAPI OAuth scopes with the permission catalog: rename plural resource scopes to singular and declare session, auth_attempt, and project-scoped configuration scopes.

**Breaking change for clients requesting the old scope names.** `flow_definitions.read`, `flow_definitions.write`, `flow_definitions.delete`, `sessions.read`, `sessions.write`, `auth_attempts.read`, and `auth_attempts.write` are renamed to their singular forms (`flow_definition.*`, `session.*`, `auth_attempt.*`). Requests minted against the plural names must be updated.
