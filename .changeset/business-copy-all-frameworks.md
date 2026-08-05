---
"@zitadel/sdk-react": minor
"@zitadel/sdk-vue": minor
"@zitadel/sdk-angular": minor
"@zitadel/sdk-svelte": minor
"@zitadel/sdk-solid": minor
"@zitadel/sdk-qwik": minor
"@zitadel/sdk-nuxt": minor
"@zitadel/cli": minor
---

The framework SDK packages (react, vue, angular, svelte, solid, qwik, nuxt) now re-export the `businessLocales` copy overlay from `@zitadel/components`, so an app that only declares its framework SDK as a direct dependency can wire the work-email wording without reaching into `@zitadel/components` (which strict package managers would not resolve). `zitadel setup --use-case business` uses this to wire the overlay into every framework's generated auth pages — previously only Next scaffolds got the business copy; the SPA scaffolds pass a plain `locales` prop to the wrapper components, and `doctor --fix` regenerates the same markup from the recorded use case.
