---
"@zitadel/cli": minor
---

Add the `zitadel auth-method` commands, one per sign-in method: `auth-method password enable|disable`, `auth-method passkey enable|disable`, and `auth-method sso enable|disable --provider <name>`. `sso disable` is new: it removes a provider from the schema and the login flows, and keeps its connection and credentials. `sso enable` keeps working as a deprecated alias of `auth-method sso enable` and says so on every run. The commands edit only local files, and `plan` and `apply` publish the change. Before writing anything, they refuse:

- disabling a method that a login flow still asks for;
- changing a method while a flow has errors that prevent checking it;
- disabling the schema's last way to sign in, unless confirmed in a terminal or `--force` is passed, for a schema whose users are only managed through the API;
- enabling password on a schema without `x-identifier`.
