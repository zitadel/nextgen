---
"@zitadel/cli": patch
---

`zitadel auth-method sso enable` no longer reports the `sso-conflict` step as edited by hand when it is what an earlier run wrote for different sign-in methods. Enabling a method such as passkey after the step was first generated now brings the step up to date with the methods enabled today; a step that was genuinely edited is still left alone and reported.
