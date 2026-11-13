---
"@zitadel/cli": patch
---

`zitadel setup --framework sveltekit` now installs dependencies once, after adding the SDKs, and not at all with `--skip-install`; it no longer has `sv create` run an npm install of its own first.
