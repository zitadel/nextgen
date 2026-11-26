---
"@zitadel/components": minor
---

`<zitadel-login>` now loads only what a page uses: the template engine, the HTML sanitiser and the German or Italian texts load when a page first needs them, so every SDK's app stays under the bundlers' 500 kB chunk warning. `standalone.mjs` is now minified.

**Breaking:** `de`, `it` and `builtinLocales` are no longer exported from the package root or `@zitadel/components/orchestrator`. Import them from `@zitadel/components/locales`; the widget still picks the translation for the page's language by itself. `startFlow`, `submitStep` and `getCurrentStep` now take the project (`ZitadelProject`) instead of an API client.
