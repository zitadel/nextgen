---
"@zitadel/cli": minor
---

Add `setup --framework react|vue|angular|nuxt` support to the CLI. Each framework scaffolds its auth entry/pages and wires `/__nextgen/*` calls to the backend with a `sk_<project_id>` bearer attached: React and Vue get a dev proxy magicast-merged into the Vite config (`vite.config.*`) that reads the project id from `ZITADEL_PROJECT_ID`; Angular gets a `proxy.conf.cjs` wired into `angular.json` that reads it from `zitadel.json` plus auth route entries for `/login`, `/register`, and `/profile`; and Nuxt registers the `@zitadel/sdk-nuxt` module in the Nuxt config (`nuxt.config.*`), which adds the proxy via server middleware. A `--dev-port` flag sets the scaffolded dev-server port.
