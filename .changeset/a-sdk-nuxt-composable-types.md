---
"@zitadel/sdk-nuxt": patch
---

The auto-imported `useAuth()` and `useZitadelProject()` composables are now typed in Nuxt apps.
`@zitadel/sdk-nuxt` ships their declarations, so `useAuth()` returns the client auth state without
the session token instead of `any`, and a typo such as `auth.sesion` or a read of
`auth.session.token` fails to compile.
