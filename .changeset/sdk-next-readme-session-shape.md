---
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

The `@zitadel/sdk-next` README and the type documentation your editor shows for `getSession()`, `useAuth()`, `auth()` and `NextgenProvider` now describe the session identity as `userId`, `identifier`, `identifierProperty` and `display`, the fields these return, instead of `userId`, `email` and `name`. The README also places `proxy.ts` next to the `app` directory. Its npm description no longer mentions a mock auth UI, and the `@zitadel/sdk-nuxt` README names the product Zitadel.
