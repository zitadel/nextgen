---
"@zitadel/components": patch
---

`<zitadel-login>` no longer asks for an email when your user schema's `x-identifier` is another field, such as `employee_number`: the sign-in screen's description needs no `locales` override any more. The passkey-first screen's fallback button now reads "Sign in another way" for every identifier.
