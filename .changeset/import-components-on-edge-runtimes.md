---
"@zitadel/components": patch
---

Importing `@zitadel/components` no longer throws `HTMLElement is not defined` on edge runtimes. Under the `workerd`, `worker` and `edge-light` export conditions the package root now resolves to an entry that never loads Lit and keeps the locales (`businessLocales` included), tokens, branding helpers and the flow API client.
