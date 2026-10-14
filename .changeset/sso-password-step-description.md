---
"@zitadel/components": patch
"@zitadel/api-mock": patch
---

A login step that offers sign-in providers now asks for `<step>.description.sso`
instead of `<step>.description`, and the password step says "Enter your password
or continue with your sign-in provider". A user who signed up with a provider
no longer reads "Enter your password" above the provider buttons for an account
with no password. A locale without the new key shows the plain description, so
nothing changes for a step that has no wording of its own.
