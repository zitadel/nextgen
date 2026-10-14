---
"@zitadel/sdk-nuxt": patch
---

Every option under `nextgen` in `nuxt.config.ts` now reaches the server middleware. The Nuxt module used to pass on only `url`, `loginPath`, and `protectedRoutes`: a custom `proxyPath` moved the widgets but not the server proxy, so sign-in failed, and `audience`, `ignoredRoutes`, `allowedAlgorithms`, `allowedTokenTypes`, `clockSkewMs`, and the timeouts had no effect. A built server can also set `audience`, `ignoredRoutes`, and the others from `NUXT_NEXTGEN_<OPTION>`, a list as JSON. If your `nextgen` block sets any of these options, check their values: they now apply.
