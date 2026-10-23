---
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

The `@zitadel/sdk-next` README now describes the client-side session as `{ userId, identifier, identifierProperty, display }`, the shape that `getSession()`, `useAuth()` and `NextgenProvider` return, instead of `{ userId, email, name }`, and places `proxy.ts` next to the `app` directory. Its npm description no longer mentions a mock auth UI, and the `@zitadel/sdk-nuxt` README names the product Zitadel.
