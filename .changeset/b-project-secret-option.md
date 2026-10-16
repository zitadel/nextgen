---
"@zitadel/sdk-next": minor
"@zitadel/sdk-nuxt": minor
---

`nextgenMiddleware`, `createProxy` and `createNextgenMiddleware` accept a `projectSecret`
option, as the other server SDKs do, for apps that load the secret at runtime. Without it,
sdk-next reads `ZITADEL_PROJECT_SECRET`, and sdk-nuxt reads `runtimeConfig.nextgen.projectSecret`
and then `ZITADEL_PROJECT_SECRET`, so a hand-written Nuxt middleware can finish sign-in.
