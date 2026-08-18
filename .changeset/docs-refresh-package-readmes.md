---
"@zitadel/cli": patch
"@zitadel/server": patch
"@zitadel/api": patch
"@zitadel/components": patch
"@zitadel/config": patch
"@zitadel/testing": patch
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-react": patch
"@zitadel/sdk-vue": patch
"@zitadel/sdk-angular": patch
"@zitadel/sdk-solid": patch
"@zitadel/sdk-svelte": patch
"@zitadel/sdk-qwik": patch
---

The package documentation now matches what the packages actually do. The Next and Nuxt guides drop the removed `api-base` attribute in favor of `configureZitadel()` and the `project` property; the Nuxt guide documents the Nuxt module (what `zitadel setup` wires) with its real options and the `useAuth()` / `useZitadelProject()` composables, alongside the hand-rolled middleware path with its full option set. `@zitadel/sdk-core` and `@zitadel/api` gain real documentation of their entry points, `@zitadel/config` gains a package README, and the SPA guides document the `ZitadelSession` card and point local no-proxy experiments at the local runtime's actual default port (8080). The flow-editing guide copied into `.zitadel/flows/` no longer suggests cross-flow `switch`/`pivot` transitions, which the runtime does not execute yet, and API examples use the real prefixed ID format (`proj_…`, `team_…`) instead of a retired naming scheme.
