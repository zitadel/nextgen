---
"@zitadel/sdk-nuxt": patch
---

The auto-imported `useZitadelProject()` and `useAuth()` composables now work as documented. The package's build left `useZitadelProject()` out, so a page calling it without an import failed with `useZitadelProject is not defined`, and it shipped no declarations for the composables, so `useAuth()` was typed `any` in Nuxt apps. Both are now built and typed, so a typo such as `auth.sesion` or a read of `auth.session.token` fails to compile.
