---
"@zitadel/cli": minor
---

Add `zitadel auth-factor enable` and `zitadel auth-factor disable`, which turn password or passkey sign-in on or off for a user schema with `--mode password` or `--mode passkey`. Repeat `--mode` to change both. The commands edit only the local schema, and `plan` and `apply` publish the change. Before writing anything, they refuse:

- disabling a factor that a login flow still asks for;
- enabling or disabling while a flow has errors that prevent checking it;
- disabling the schema's last way to sign in, unless confirmed in a terminal or `--force` is passed, for a schema whose users are only managed through the API;
- enabling password on a schema without `x-identifier`.
