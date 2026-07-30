---
"@zitadel/server": minor
---

Rename a team with `PATCH /teams/{team_id}`. The name is required, is trimmed, and must be 1 to 200 characters. It must be unique within the project ignoring case, so a taken name returns 409. Only active teams can be renamed: a deactivated or unknown team returns 404. `createTeam` now declares its 403 response, which was missing from the contract.