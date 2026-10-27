---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/components": minor
"@zitadel/config": patch
"@zitadel/cli": patch
---

`<zitadel-login>` now tells visitors why it switched between sign-in and sign-up by itself. An email with no account on the sign-in screen goes on as a sign-up, with a note that no account was found. An email that already has an account on the sign-up screen goes on as a sign-in, and says so. A sign-in with an identity provider that has no account yet gets the same note.

Every step the flow API returns now carries `purpose` (`login`, `register`, …), and the step right after such a switch carries `notice`: `notice.user_not_found`, `notice.user_already_exists` or `notice.sso_user_not_found`. A page that shows its own heading in place of the widget's should follow `step.purpose` from the `zitadel-flow-step` event, not step names. Reword a notice with `locales`. The login designs `zitadel branding eject` copies show the notice; a design ejected earlier shows it once its template renders `messages`.
