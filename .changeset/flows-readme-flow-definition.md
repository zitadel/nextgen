---
"@zitadel/config": patch
---

The flows README that `zitadel setup` writes into `.zitadel/flows/` now calls each file a flow definition, and the one `<zitadel-login>` runs without `flowName` the project default, as the `zitadel flow-definitions` commands and the `@zitadel/components` README do. Its advice for keeping the current project default reads the same as the `zitadel plan` warning.
