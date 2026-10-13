---
"@zitadel/sdk-nuxt": patch
---

The Nuxt module now reads `ZITADEL_URL` and `NUXT_PUBLIC_ZITADEL_PROJECT_ID` from `.env.local` when the environment does not set them, as it already did `ZITADEL_PROJECT_SECRET`, so a changed `.env.local` takes effect even though Nuxt itself loads only `.env`; a value in `nuxt.config.ts` still wins. Every fallback for the backend URL is now `http://localhost:8080`, where `zitadel start` runs the local server.
