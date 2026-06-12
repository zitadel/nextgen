---
"@zitadel/cli": minor
---

Add `setup --framework react|vue|angular|nuxt` support to the CLI. Each framework scaffolds its auth entry/pages and wires a dev proxy that forwards `/__nextgen` to the backend and attaches a `sk_<project_id>` bearer (from `ZITADEL_PROJECT_ID`) to the forwarded requests: a magicast merge into the Vite config (`vite.config.*`) for React and Vue, a `proxy.conf.cjs` wired into `angular.json` for Angular, and the `@zitadel/sdk-nuxt` module registered in the Nuxt config (`nuxt.config.*`) for Nuxt.
