---
"@zitadel/components": patch
"@zitadel/sdk-nuxt": patch
---

Importing `@zitadel/components` no longer throws `HTMLElement is not defined` on edge runtimes. When `browser` is active together with `workerd`, `worker` or `edge-light`, the package root now resolves to an entry that never loads Lit and keeps the locales (`businessLocales` included), tokens, branding helpers, the attribution markup and the flow API client. The elements are not in it, so `@zitadel/sdk-react`, which imports them, still cannot be bundled for those runtimes. The Nuxt README now states that its Nitro middleware needs Node.
