---
"@zitadel/components": patch
---

Tidy the web components package: align README/AGENTS docs with the real SDK-config API, adopt idiomatic Lit patterns (`classMap`, `live()`, `ifDefined`, `@query`, a shared `emit()` helper), make post-step focus deterministic via `updateComplete` instead of `requestAnimationFrame`, centralise SDK/API resolution in a `resolveApi()` helper, correct the manifest registry (e.g. `zl-passkey` `method` attribute), and expand unit/browser test coverage.
