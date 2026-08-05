---
"@zitadel/components": patch
---

Forward atom CSS Shadow Parts through `<zitadel-login>`: host pages can now restyle atom internals with `zitadel-login::part(<atom>-<part>)` (e.g. `field-input`, `button-root`); the mapping is derived from the atom manifests and stamped on every render, covering gate-patched atoms too.
