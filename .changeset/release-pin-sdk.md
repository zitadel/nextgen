---
"@zitadel/api": minor
"@zitadel/components": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/sdk-angular": minor
"@zitadel/testing": minor
"@zitadel/cli": minor
---

Pin a build to the release it was built against: pass `release` to `configureZitadel()` (or the `release` attribute on `<zitadel-login>`, `NUXT_PUBLIC_ZITADEL_RELEASE` in Nuxt) and the flow start sends it as `X-Zitadel-Release`. `zitadel deploy` and `zitadel preview` print the value to bake in as `NEXT_PUBLIC_ZITADEL_RELEASE=rel_…`, and `zitadel-flow-error` carries the server's `code`, so an app can tell a revoked release from other failures.
