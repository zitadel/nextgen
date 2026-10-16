---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

`protectedRoutes` and `ignoredRoutes` entries now match with or without a trailing slash, so `/profile/` can no longer bypass `protectedRoutes: ["/profile"]`.
