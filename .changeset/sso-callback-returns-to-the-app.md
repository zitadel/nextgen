---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

Signing in with an external identity provider now returns to your app instead of leaving the browser on a blank page. `@zitadel/sdk-next` and `@zitadel/sdk-nuxt` discarded the redirect the provider's callback answers with, so a successful sign-in never reached the page that started it.
