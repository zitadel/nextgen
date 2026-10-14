---
"@zitadel/server": patch
"@zitadel/components": patch
---

A password submitted on a sign-in step with no user to check it against now re-renders the step with `error.sign_in_first` instead of failing with an API error. This happens on the `sso-conflict` step after going back to it from `sign_in`, or when a flow reaches it without binding the colliding user. A sign-in password is no longer kept in the flow state once it has been checked, or when there is no user to check it against. The login components translate the new error in English, German and Italian.
