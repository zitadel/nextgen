---
"@zitadel/cli": patch
---

`zitadel grants create --json` for a user named by `user.identifier` now includes `data`, an empty object, in its JSON envelope. The platform accepts that request with `202 Accepted` and no body, and the envelope used to leave `data` out. Run `zitadel grants list` to see whether a grant was written.
