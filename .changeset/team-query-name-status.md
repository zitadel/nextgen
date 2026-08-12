---
"@zitadel/server": minor
---

Add `name` and `status` as filter and sort fields on `POST /teams/query`. A `name` filter matches exactly with `equals` and case-insensitively with `contains`. `status` filters on the contract's two values, `active` and `deactivated`.

Teams pending purge no longer surface through the API: `getTeam` answers 404 for them, and `queryTeams` omits them. They previously read as `deactivated`.