---
"@zitadel/cli": patch
---

The Nuxt scaffold no longer adds `@zitadel/api`, `@zitadel/components` and `@zitadel/design-tokens` to `build.transpile` in `nuxt.config.ts`. The app depends only on `@zitadel/sdk-nuxt`, which owns those packages, and builds and renders the login page without the entries. Apps scaffolded earlier keep their entries, which are harmless, and `doctor` and `eject` still recognise their config as wired.
