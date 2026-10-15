---
"@zitadel/components": patch
"@zitadel/server": patch
---

A login step that offers sign-in providers now asks for `<step>.description.sso`
instead of `<step>.description`, and the password step says "Enter your password
or continue with your sign-in provider". A user who signed up with a provider
no longer reads "Enter your password" above the provider buttons for an account
with no password. Every other step has no wording of its own and shows its plain
description. If you override a step's description in `locales` but not its `.sso`
variant, your text is shown whether or not the step offers providers.
