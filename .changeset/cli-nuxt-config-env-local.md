---
"@zitadel/cli": patch
---

`zitadel setup` no longer writes the server URL and the project id into a Nuxt app's `nuxt.config.ts` as fixed fallbacks, so the app follows `ZITADEL_URL` and `NUXT_PUBLIC_ZITADEL_PROJECT_ID` in `.env.local`, as Next.js and Vite apps do. It also stops writing the unused `runtimeConfig.zitadelUrl` and `runtimeConfig.public.nextgenProxyPath`. An app set up earlier keeps its config: remove `nextgen.url` and `runtimeConfig.public.zitadelProjectId` from its `nuxt.config.ts` to follow `.env.local` too.
