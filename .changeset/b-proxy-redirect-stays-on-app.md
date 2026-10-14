---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

A redirect the `/__nextgen` proxy forwards can no longer leave your app. A redirect whose path
started with `//` (for example back to `https://your-app//evil.example/login`, after a sign-in with
an identity provider started on such a page) was turned into a redirect to `evil.example`. The
proxy now keeps the path on your app's own origin.
