---
"@zitadel/cli": patch
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
---

CLI scaffolds now write the project service-key secret to `.env.local` as `ZITADEL_PROJECT_SECRET`, and the React/Vue/Angular dev proxies plus the Next.js and Nuxt server middlewares send it as the bearer on every proxied request instead of synthesising `sk_<project_id>` from the public project id. The secret stays server-side: `.env.local` is gitignored, Vite only exposes `VITE_`-prefixed vars to the client, Next.js auto-loads `.env.local` into `process.env` server-side, and the Nuxt module reads `process.env.ZITADEL_PROJECT_SECRET` in its `setup()` and pushes it into Nuxt's server-only `runtimeConfig.nextgen.projectSecret` (overridable at deploy time via `NUXT_NEXTGEN_PROJECT_SECRET`).

Also drops the unused `onExchangeResponse` hook from `NextgenMiddlewareOptions` (no callers anywhere; alpha so no external usage to break).
