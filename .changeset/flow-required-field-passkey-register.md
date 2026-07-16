---
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Fix flow engine: enforce a step's required fields on the passkey-register issue leg, not just the submit action. Clicking "continue with passkey" on a register step that collects required attributes (e.g. an unselected required `select`) now halts with a per-field error instead of minting a challenge that only fails later when `create_user` validates the user against the schema.
