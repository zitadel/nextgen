---
"@zitadel/sdk-nuxt": minor
"@zitadel/api": patch
---

Render the auth widgets in Nuxt via auto-imported Vue components.

The SDK config handle is now stored on a `globalThis` slot keyed by `Symbol.for(...)` instead of a module-local variable, so the copy of the config module bundled into `@zitadel/components` reads the same handle that `configureZitadel()` writes.

The `@zitadel/sdk-nuxt` module now auto-imports `<ZitadelLogin>` and `<ZitadelLogout>` Vue components, so a page can drop them in without importing anything or configuring `vue.compilerOptions.isCustomElement`. They wrap the `<zitadel-login>` / `<zitadel-logout>` Lit web components with a render function (string tag), so SSR emits the inert element and the browser upgrades it after hydration; the element registry (`@zitadel/components`) is imported in `onMounted`, i.e. client-only.

The module also wires `runtimeConfig.public.zitadelProjectId` (from a `projectId` option or `NUXT_PUBLIC_ZITADEL_PROJECT_ID`). Without it the runtime plugin's `configureZitadel()` call was skipped, so the SDK global stayed empty and the widget could not start its flow. The widgets read proxy path and project id from that global, so no per-instance `project` prop is required.
