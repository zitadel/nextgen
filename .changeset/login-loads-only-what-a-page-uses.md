---
"@zitadel/components": minor
---

The login widget now loads only what a page uses, which keeps every SDK's app under the bundlers' 500 kB chunk warning. It calls the seven API endpoints it needs by name instead of the whole generated client, sanitises with the browser's own `Element.setHTML()` and loads DOMPurify only where that is missing (Safari), loads LiquidJS when it first renders, and loads the German or Italian dictionary only for a page in that language. `standalone.mjs` is now minified, and the CSS and HTML inside the atoms' Lit templates are minified when the package builds.

**Breaking:** `de`, `it` and `builtinLocales` are no longer exported from the package root or `@zitadel/components/orchestrator`. Import them from `@zitadel/components/locales`; the widget still picks the translation for the page's language by itself. `startFlow`, `submitStep` and `getCurrentStep` now take the project (`ZitadelProject`) instead of an API client.
