---
"@zitadel/server": minor
---

`POST /projects/{project_id}/claim/complete` now distinguishes two reasons for its 403. `claim.no_personal_team` still means the user has no team yet, which clears itself because the next sign-in provisions one. The new `claim.personal_team_not_active` means the team exists but is not active, which no amount of retrying will clear and only an administrator can undo; its `details.details.membership_status` tells a removed team from a pending invitation. The 403 response is now a `oneOf` over the two codes discriminated on `code`, so generated clients get a variant per code instead of typing every 403 as the old one.
