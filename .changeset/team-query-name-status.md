---
"@zitadel/server": minor
---

Add `name` and `status` as filter and sort fields on `POST /teams/query`. A `name` filter matches case-insensitively with both `equals` and `contains`, because team names are unique per project case-insensitively. `status` filters on the contract's two values, `active` and `deactivated`.

`contains` on a text field is now a case-insensitive substring match on every query endpoint, not only on teams.

Teams pending purge no longer surface through the API: `getTeam` answers 404 for them, and `queryTeams` omits them. They previously read as `deactivated`.
