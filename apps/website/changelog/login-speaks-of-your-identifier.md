---
title: The login stops asking for an email when users sign in by another field
summary: When your user schema's x-identifier is another field, such as employee_number, the login no longer asks for an email or names one in its notices and errors, and needs no locales override for it.
date: 2026-11-24T20:02Z
pulls: [3302, 3309]
---

If your user schema signs users in by a field other than an email, such as `x-identifier: employee_number`, `<zitadel-login>` no longer asks for an email. The sign-in screen reads "Enter your details to continue" above the field's own label, so you need no `locales` override for it, and its notices and errors name no email either. The new texts come in English, German and Italian.

- The notice on the sign-up screen that a sign-in moved to reads `notice.user_not_found.custom_identifier` for such an identifier: "We couldn't find an account with those details".
- For every identifier, a wrong password reads "Wrong password.", a passkey that is not registered asks you to sign in another way, and a sign-up that moved to sign-in says that an account with these details already exists.
- The passkey-first screen's fallback button reads "Sign in another way" for every identifier.
- A description or notice that you rewrote in `locales` still shows, whatever the identifier is.

[Customize the login text](https://preview.zitadel.com/docs/guides/customize-copy)
