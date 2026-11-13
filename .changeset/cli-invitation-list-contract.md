---
"@zitadel/cli": minor
---

`zitadel invitation list` leaves accepted invitations out unless `--status` asks for them, and `--status` can be repeated to list several statuses. `zitadel invitation get` reports `responded_by` and `responded_at` in place of `accepted_by` and `accepted_at`, and `zitadel invitation cancel` also removes a declined invitation.
