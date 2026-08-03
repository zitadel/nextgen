---
"@zitadel/server": minor
---

Teams now expose their lifecycle status. `status` is `active` or `deactivated` and is returned by the create, get and update team endpoints. A deactivated team is still readable through `GET /teams/{team_id}`, so it can be told apart from an active one. Create now returns the same team state as get and update, so its response also carries `updatedAt`.