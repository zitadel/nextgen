---
"@zitadel/components": minor
---

Allow configuring `<zitadel-login>` and `<zitadel-logout>` declaratively from HTML via `project-id`, `proxy-path`, and `url` attributes, so the components work on a plain page without JS or `configureZitadel()`. The existing `project` property and the `configureZitadel()` global still take precedence, in that order.

Also fix the standalone bundle so it loads in a browser: it was built for Node and emitted an `import "node:module"` that browsers cannot resolve. It is now built for the browser, so `dist/standalone.mjs` is genuinely self-contained.
