---
"@zitadel/server": patch
"@zitadel/components": patch
---

An SSO sign-in whose provider account is linked to a user of a schema the flow does not serve now ends with `flow.sso_user_schema_mismatch` instead of `flow.restart_required`. `<zitadel-login>` shows "This account can't sign in with this provider. Please try another way to sign in, or contact your administrator." in English, Italian and German, rather than asking the visitor to start again, which could never succeed.
