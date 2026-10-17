---
"@zitadel/sdk-nuxt": patch
---

`useZitadelProject()` is auto-imported as documented. The package's build left the composable out,
so a page calling it without an import failed with `useZitadelProject is not defined`.
