---
"@zitadel/server": patch
"@zitadel/config": patch
---

Flow definition validation now refuses an action named `sso`, on the server
and in `@zitadel/config`. The engine treats a submission with that action as
an external sign-in, so a navigate action of that name validated and then
failed every submission with `flow.invalid_action`. An sso submission on an
attempt that is already handed off answers `409` with
`att.already_handed_off` instead of `500`.
