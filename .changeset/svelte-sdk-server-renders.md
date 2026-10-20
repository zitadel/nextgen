---
"@zitadel/sdk-svelte": patch
---

The published Svelte package now server-renders: it ships its components' source under the `svelte` export condition, so your Svelte build compiles them for the server as well as the browser, instead of the client-only build that threw `effect_orphan` when rendered with `svelte/server`.
