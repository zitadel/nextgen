---
"@zitadel/cli": patch
---

Scaffolded auth pages now derive their embedding posture from how setup met the app (ADR 044). Fresh scaffolds keep the widgets' full-page chrome; a pre-existing Next or Nuxt app gets `variant="widget"` cards with `theme="auto"` in a layout-neutral wrapper, so the login no longer paints token-colored chrome underneath the host app's own header and theme. Nuxt setup also stops writing `app.vue`/`pages/index.vue` into pre-existing apps — the shell and homepage stay user-owned, mirroring Next. The chosen posture is recorded in the scaffold manifest and `doctor --fix` restores it; manifests without a record restore full-page. A new `dependency-version` doctor check warns (with the exact install command) when an exactly-pinned `@zitadel/*` dependency trails the CLI's own train, so a newer CLI's guidance can't silently reference SDK entry points the app's pinned SDK does not ship yet.
