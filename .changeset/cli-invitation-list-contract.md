---
"@zitadel/cli": minor
---

`zitadel invitation list` leaves accepted invitations out unless `--status` asks for them, and `--status` can be repeated to list several statuses. `zitadel invitation cancel` reads the invitation before it asks: the question names who it is for and its role, an accepted or expired invitation fails with `E_VALIDATION` before anything is asked, and without an id it offers declined invitations as well as pending ones.
