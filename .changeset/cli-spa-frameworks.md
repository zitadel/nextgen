---
"@zitadel/cli": minor
---

Add `setup --framework react|vue|angular|nuxt` support to the CLI. Each framework scaffolds its auth entry/pages and wires a dev proxy that forwards `/__nextgen` to the backend and injects the project service-key on `/sessions/exchange`: a magicast merge into `vite.config.ts` for React and Vue, a `proxy.conf.cjs` wired into `angular.json` for Angular, and the `@zitadel/sdk-nuxt` module registered in `nuxt.config.ts` for Nuxt.
