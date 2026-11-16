---
"@zitadel/cli": patch
---

`zitadel setup --framework nuxt`, `angular` and `tanstack-start` now install dependencies once, after adding the SDKs, and not at all with `--skip-install`; the framework's own generator no longer runs an npm install of its own first.
