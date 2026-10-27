---
"@zitadel/sdk-sveltekit": patch
"@zitadel/cli": patch
---

`@zitadel/sdk-sveltekit/vite` adds a `zitadel()` Vite plugin that, while `vite dev` runs, puts the `ZITADEL_*` variables from the app's env files on `process.env`, where `createNextgenHandle` reads them, keeping any variable already set. `zitadel setup` adds the plugin to a SvelteKit app's `vite.config.ts`, and the `src/hooks.server.ts` it writes passes only the route policy and names no Node global, so `npm run check` passes without `@types/node` instead of reporting "Cannot find name 'process'".
