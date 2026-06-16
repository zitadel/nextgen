---
"@zitadel/cli": patch
"@zitadel/sdk-nuxt": patch
---

CLI scaffolds now write the project service-key secret to `.env.local` as `ZITADEL_PROJECT_SECRET`, and the React/Vue/Angular dev proxies and the Nuxt server middleware send it as the bearer on every proxied request instead of synthesising `sk_<project_id>` from the public project id. The secret stays server-side: `.env.local` is gitignored, Vite only exposes `VITE_`-prefixed vars to the client, and the Nuxt middleware reads `process.env.ZITADEL_PROJECT_SECRET` from the node runtime.
