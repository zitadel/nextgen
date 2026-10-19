---
"@zitadel/sdk-qwik": patch
---

A widget prop that is unset or cleared in the Qwik components now restores the web component's own default instead of keeping its last value. For example, clearing the `heading` of `<ZitadelSession />` brings back the default "Signed in as" title.
