---
"@zitadel/cli": patch
---

Offer the sign-in provider on the password step. Someone who signed up with a provider has no password, and typing their email instead of clicking the button sent them to a password step with only a password field and no way out. `zitadel sso enable` and `zitadel setup` now add the enabled providers to that step too, and rerunning `sso enable` adds them to an existing project's unedited password step. A password step edited by hand is left alone and reported, like the other generated steps.
