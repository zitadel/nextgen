---
"@zitadel/cli": patch
---

The `zitadel plan` warning about a flow definition becoming the project default for `<zitadel-login>` now gives advice that keeps the current default: give a new flow definition an `audience` before its first apply and select it by `flowName`, or pin `flow-name` on the pages that should keep the current project default. It used to suggest setting `flow-name` on the pages that should use the new one, which leaves it the project default on every other page.
