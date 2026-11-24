---
"@zitadel/cli": minor
---

`--server` is no longer taken by `tests add`, `skills add`, `upgrade`, `eject` and `branding eject`, which never used it: a script that passes it to them now gets an unknown-flag error, and the commands they suggest next no longer carry it.
