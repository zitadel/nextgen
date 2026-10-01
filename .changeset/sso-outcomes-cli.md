---
"@zitadel/cli": minor
---

`zitadel setup` and `zitadel sso enable` write the renamed SSO outcomes into the login flow: `sso_authenticated` and `sso_user_not_found`. `user_already_exists` keeps its name and is shared with the typed collision. On a flow an earlier version wrote, `zitadel sso enable` renames `callback` and `identity_unknown` to the new keys, so enabling another provider keeps the flow valid.
