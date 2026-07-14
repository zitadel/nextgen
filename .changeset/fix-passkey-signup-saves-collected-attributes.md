---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Fix passkey signup silently dropping every collected user attribute except the identifier. The passkey-register now routes user creation through `UserService`.