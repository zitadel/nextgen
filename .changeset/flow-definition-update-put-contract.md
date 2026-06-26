---
"@zitadel/cli": patch
---

Align the CLI flow-definition sync update with the PUT contract: send the `{ flow_definition }` body envelope and the required `project_id` query parameter so updates to existing flow definitions are accepted by the generated server.
