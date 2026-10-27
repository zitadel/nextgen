---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/components": minor
"@zitadel/config": patch
"@zitadel/cli": patch
---

`<zitadel-login>` now says why it switched between sign-in and sign-up by itself: an email without an account becomes a sign-up, with a note to fix a typo in the email field, and one with an account a sign-in; an identity provider sign-in without an account gets the same note. Flow API steps carry `purpose` and, after a switch, `notice`.

**Upgrading a page or design from an earlier release:** a page that shows its own heading in place of the widget's should follow `step.purpose` from the `zitadel-flow-step` event, not step names, and a design ejected earlier shows the notice once its template renders `messages`, as the designs `zitadel branding eject` copies now do.
