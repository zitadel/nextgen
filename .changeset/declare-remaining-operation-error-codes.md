---
"@zitadel/server": patch
"@zitadel/api": patch
---

Declare the error codes that the branding, event, team, project-claim and health operations return. Their error response described only the generic `{ code, message }` shape, so the OpenAPI document and the API reference did not list which codes these 17 operations can send. Each now names its codes, like every other operation, and the `@zitadel/api` client gains a code-discriminated `<Operation>Default` type for each (for example `GetTeamDefault`) to branch on.
