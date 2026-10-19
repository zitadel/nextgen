---
"@zitadel/sdk-nuxt": patch
---

The Nuxt module no longer copies `ZITADEL_URL` and `ZITADEL_PROJECT_SECRET` from the build environment and `.env.local` into the build output. Before, `nuxt build` wrote the project secret into `.output/server`, and a deployed app could not change its backend URL without a rebuild. A built server now reads both from its own runtime environment when it starts, `NUXT_NEXTGEN_URL` and `NUXT_NEXTGEN_PROJECT_SECRET` take precedence, and a `nextgen.url` set in `nuxt.config.ts` is still honored. `nuxt dev` keeps reading `.env.local`. A built server no longer reads `.env.local`, so set the variables in its runtime environment.
