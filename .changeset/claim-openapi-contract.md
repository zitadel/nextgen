---
"@zitadel/server": minor
"@zitadel/api": minor
---

Add the project claim lifecycle endpoints to the API: `POST /projects/{project_id}/claim/init`, `GET /projects/{project_id}/claim/status`, and `POST /projects/{project_id}/claim/complete`, with matching methods on the generated `@zitadel/api` client. These let a developer start a claim from the CLI, poll its status, and finish it from the browser. The status response is modelled as discriminated `pending`/`completed` variants, and the contract carries the `proj.already_claimed` (409) and `proj.claim_expired` (410) error codes plus `429` rate-limit responses on polling and completion. The server handlers arrive separately, so the operations currently respond `501 Not Implemented`.
