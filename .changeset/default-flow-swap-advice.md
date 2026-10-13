---
"@zitadel/cli": patch
---

The `zitadel plan` warning about a flow becoming the default for `<zitadel-login>` now gives advice that keeps the current default: give the new flow an `audience` before its first apply and select it by `flowName`, or pin `flow-name` on the pages that should keep the current flow. It used to suggest setting `flow-name` on the pages that should use the new flow, which leaves the new flow the default on every other page.
