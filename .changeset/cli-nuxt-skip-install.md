---
"@zitadel/cli": patch
---

`zitadel setup --framework nuxt` now installs dependencies once, after adding the SDKs, and not at all with `--skip-install`; it no longer has `nuxi init` run an npm install of its own first.
