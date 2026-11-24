---
"@zitadel/components": patch
---

`<zitadel-login>` names no email in its notices and sign-in errors when your user schema's `x-identifier` is another field, such as `employee_number`. The notice on the sign-up screen a sign-in moved to reads `notice.user_not_found.custom_identifier` for such an identifier. For every identifier, a wrong password now reads "Wrong password.", a passkey that is not registered asks you to sign in another way, and a sign-up that moved to sign-in says that an account with these details already exists.
