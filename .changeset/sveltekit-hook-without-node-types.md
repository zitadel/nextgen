---
"@zitadel/sdk-sveltekit": patch
"@zitadel/cli": patch
---

`createNextgenHandle` now loads `.env.local` into `process.env` before reading `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET`, keeping any variable already set, so a SvelteKit app no longer loads the file itself. The `src/hooks.server.ts` that `zitadel setup` writes passes only the route policy and names no Node global, so `npm run check` passes in a SvelteKit app without `@types/node` instead of reporting "Cannot find name 'process'".
