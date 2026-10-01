---
"@zitadel/cli": minor
---

`zitadel setup` and `zitadel sso enable` write the renamed SSO outcomes into the login flow: `sso_authenticated` and `sso_user_not_found`. `user_already_exists` keeps its name and is shared with the typed collision. On a flow an earlier version wrote, `zitadel sso enable` renames `callback` and `identity_unknown` to the new keys, so enabling another provider keeps the flow valid. If a step the command edits already has an action named like an outcome it writes there (`sso_authenticated`, `sso_user_not_found` or `user_already_exists`), whether or not the flow still uses the old keys, the command stops with a validation error naming the step and the action, so you can rename that action first.
