---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

When Zitadel does not answer a proxied `/__nextgen/*` call, every server SDK now responds with a
502 (unreachable) or 504 (`proxyTimeoutMs` elapsed) carrying a `{ code, message }` body, instead
of the framework's HTML 500 page.
