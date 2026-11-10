---
title: Nuxt apps installed with npm load the SDK again
summary: Pages that import from @zitadel/sdk-nuxt no longer fail to load in apps installed with npm, and nuxt dev loads the login's widgets as one module.
date: 2026-11-06T23:31Z
pulls: [2585, 2584]
---

Pages that import from `@zitadel/sdk-nuxt` no longer fail to load in the browser with `does not provide an export named 'toWebRequest'` in apps installed with npm. npm paired the SDK with h3 2; its h3 peer range is now `^1.15.0`, the h3 line Nuxt 4 runs on.

`nuxt dev` also pre-bundles the dependencies of `<zitadel-login>` and the other widgets when it starts. The first page that shows a widget loads them as one module, instead of fetching lit, lucide and `@zitadel/components` file by file: about 2,000 requests in a new app.
