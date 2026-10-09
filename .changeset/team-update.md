---
"@zitadel/server": minor
"@zitadel/api": minor
---

Rename a team with `PATCH /teams/{team_id}`. The name is trimmed and must be 1 to 200 characters. It must be unique within the project ignoring case, so a taken name returns 409. Only active teams can be renamed: a deactivated or unknown team returns 404. `createTeam` now declares its 403 and 404 responses, which were missing from the contract. The team response schema is now shared between `getTeam` and `updateTeam`, renaming the generated `GetTeamResponse` type to `TeamResponse`.
