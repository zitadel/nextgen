---
"@zitadel/server": patch
---

Fix embedded default-login-flow seeding dropping each transition's `purpose`
field, which left the login flow's Sign Up link unable to switch the flow
into registration mode.
