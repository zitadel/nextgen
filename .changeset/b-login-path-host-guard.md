---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The `loginPath` check now also refuses paths a browser reads as another site: one with a backslash
(`/\evil.example`), a tab, newline or other whitespace or control character, or the same written
percent-encoded (`/%5Cevil.example`). Such a path made the protected-route redirect leave your app.
A `loginPath` like that now fails when the middleware is set up, as an absolute URL already did.
