---
"@zitadel/cli": patch
---

The Nuxt scaffold now declares `@zitadel/components`, which its client plugin imports, so the app installs and builds under pnpm and Yarn PnP. Its pages no longer import from `@zitadel/sdk-nuxt`, whose composables the module auto-imports, so the widgets load in the browser only. Setup no longer writes `plugins/auth.server.ts`, which repeated what the module's own plugin does, and `eject` still removes the copy an older setup wrote. `doctor --fix` now clears the record of that file from an older app once it is deleted, where `doctor` used to keep failing on it.
