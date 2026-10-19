---
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

Remove a client-supplied `x-nextgen-auth-token` header from every request before application code can see it, and answer 400 when it cannot be removed. Next.js and Nuxt previously handled the header only on ignored routes and after authentication, never refused a request, and Nuxt skipped the proxy path.
