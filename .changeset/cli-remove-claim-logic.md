---
"@zitadel-nextgen/cli": minor
---

Remove the pre-claim / claim lifecycle from the CLI and api-mock. The `zitadel claim` and `zitadel claim status` commands, the `ClaimClient` interface, the `InitClaim*` / `ClaimStatus*` schemas, the `claimed_at` / `team_id` fields on `.zitadel/secret`, the `E_CLAIM_REQUIRED` and `E_PLATFORM_HANDOFF` error codes, the production-claim gates in `apply` and `deploy connect`, and the api-mock's `claim/init` / `claim/status` handlers and `completeMockClaim()` export are all gone. `/projects/{id}/claim/init` and `/projects/{id}/claim/status` are not in the OpenAPI spec and have no backend; the surface only worked against the mock.
