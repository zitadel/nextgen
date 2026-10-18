---
"@zitadel/cli": patch
---

Every framework detector now declares its minimum version and one shared check enforces it, so `setup` and `doctor` refuse Nuxt below 4, Vue below 3, Angular below 17, Solid below 1.6 and Qwik below 2.0.0-beta.45 (the first release the SDK accepts) up front, as they already did for Next.js, React and Svelte. The SDK peer ranges already refused these at install time; the CLI now says so at setup with an upgrade hint. Angular below 17 now fails with `E_UNSUPPORTED_PROJECT_SHAPE` instead of `E_VALIDATION`, and every framework is also judged by its installed version, not only Next.js.
