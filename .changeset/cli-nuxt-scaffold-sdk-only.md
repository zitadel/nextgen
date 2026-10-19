---
"@zitadel/cli": patch
---

The Nuxt scaffold now depends only on `@zitadel/sdk-nuxt`, never on `@zitadel/components`. Its pages import nothing from `@zitadel/*`, and the business copy overlay comes from `useNuxtApp().$zitadelBusinessLocales`, which the SDK module provides. Setup no longer writes `plugins/zitadel-components.client.ts` or `plugins/auth.server.ts`, because the module loads the widgets and seeds the auth state itself. `eject` still removes both from apps an older setup wrote, and `doctor --fix` drops their records from the scaffold manifest once they are deleted. This needs the SDK release that makes the module load the elements.
