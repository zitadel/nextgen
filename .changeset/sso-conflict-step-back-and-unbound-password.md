---
"@zitadel/server": patch
"@zitadel/components": patch
---

A password submitted on a sign-in step with no user to check it against now re-renders the step with `error.sign_in_first` instead of failing with an API error. This happens on the `sso-conflict` step after going back to it from `sign_in`, or when a flow reaches it without binding the colliding user. A sign-in password is no longer kept in the flow state once it has been rejected or verified, except on a step with its own `on_success`, which still reads it. A transition from a step back to itself under the same purpose no longer adds a history entry, so back leads out of the step instead of to itself. The `sso-conflict` step does this when a repeated provider collision shows it again, and so does any other step a flow definition routes to itself, such as a resend action. The login components translate the new error in English, German and Italian.
