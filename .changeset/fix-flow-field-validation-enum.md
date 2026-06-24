---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Fix flow API: select-typed step fields now include their `validation.enum` in the response. The API mapper was dropping the resolver-derived enum, so clients rendering a `select` had no option values to display.
