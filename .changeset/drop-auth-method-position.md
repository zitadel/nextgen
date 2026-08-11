---
"@zitadel/cli": patch
"@zitadel/config": patch
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Drop `position` from `x-auth-methods` entries; `enabled` is now the only
required key. The user schema declares which authentication methods a user type
supports. Presentation concerns such as the order methods are offered in belong
to the flow engine, which takes them from the order of a step's actions in the
flow definition.
