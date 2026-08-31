---
"@zitadel/server": minor
---

`POST /projects/{project_id}/claim/complete` now distinguishes two reasons for its 403. `claim.no_personal_team` still means the user has no team yet, which clears itself because the next sign-in provisions one. The new `claim.personal_team_not_active` means the team exists but is not active, which no amount of retrying will clear and only an administrator can undo; its `details.membership_status` tells a removed team from a pending invitation. Clients that branch on the code can now say which of the two happened instead of offering one message for both.
