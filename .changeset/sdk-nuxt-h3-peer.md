---
"@zitadel/sdk-nuxt": patch
---

Pages that import from `@zitadel/sdk-nuxt` no longer fail to load in the browser (`does not provide an export named 'toWebRequest'`) in apps installed with npm, which paired the SDK with h3 2. Its h3 peer range is now `^1.15.0`, the h3 line Nuxt 4 runs on.
