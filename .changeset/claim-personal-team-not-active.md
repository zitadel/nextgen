---
"@zitadel/server": minor
---

`POST /projects/{project_id}/claim/complete` now distinguishes two reasons for its 403. `claim.no_personal_team` still means the user holds no team membership at all, which clears itself because the next sign-in provisions one. The new `claim.personal_team_not_active` means the membership exists but is not active, and `details.details.membership_status` says which state it is in: `removed` (the team or the user was deactivated, so an administrator has to restore it), `pending`, or `inactive`. Clients can branch on the code to stop offering one message for both, and on the status to say what would actually clear it. The 403 response is now a `oneOf` over the two codes discriminated on `code`, so generated clients get a variant per code instead of typing every 403 as the old one.
