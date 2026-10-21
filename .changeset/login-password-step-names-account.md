---
"@zitadel/components": minor
"@zitadel/config": patch
---

The password step of `<zitadel-login>` now shows the account it signs in to, with a "Use another account" link that goes back to the step where the email was typed. Templates ejected with `zitadel branding eject` before this release keep their markup; eject again to get the account row.
