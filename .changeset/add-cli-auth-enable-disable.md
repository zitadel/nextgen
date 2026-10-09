---
"@zitadel/cli": minor
---

Add the `zitadel auth-method` commands, one per sign-in method: `auth-method password enable|disable`, `auth-method passkey enable|disable`, and `auth-method sso enable|disable --provider <name>`. `zitadel auth-method sso disable` is new: it removes a provider from the schema and the login flows, and keeps its connection and credentials. `zitadel sso enable` keeps working as a deprecated alias of `zitadel auth-method sso enable` and says so on every run. The commands change only local files, apart from `auth-method sso enable`, which also stores the provider's credentials on the project; `plan` and `apply` publish the schema and flow changes. Before writing or publishing anything, they refuse:

- disabling a method that a login flow still asks for;
- changing a method while a flow has errors that prevent checking it;
- disabling the schema's last way to sign in, unless you confirm in a terminal or pass `--force` (meant for a schema whose users are only managed through the API);
- enabling password on a schema without `x-identifier`;
- editing a value that is not the shape these commands edit, or a schema that points at an external URL.
