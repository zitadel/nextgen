---
"@zitadel/sdk-nuxt": patch
---

`nuxt dev` now pre-bundles the dependencies of `<zitadel-login>` and the other widgets when it starts, so the first page that shows a widget loads them as one module instead of fetching lit, lucide and `@zitadel/components` file by file (about 2,000 requests in a new app).
