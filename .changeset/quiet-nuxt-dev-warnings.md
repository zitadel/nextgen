---
"@zitadel/sdk-nuxt": patch
"@zitadel/cli": patch
---

A Nuxt app set up by the CLI no longer logs two warnings in dev. The SDK plugin stops reading its private runtime config in the browser, which Nuxt reported as NUXT_E1003, and the scaffolded home page now has a template, so Vue stops warning that it has nothing to render.
