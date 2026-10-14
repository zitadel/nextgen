---
"@zitadel/sdk-angular": minor
---

`configureZitadel`, `getApi` and `getZitadelConfig` now come from `@zitadel/api/config`, like the
other SPA SDKs: `configureZitadel` records the app-wide config (so a component without `[project]`
picks it up) and accepts a `publishableKey`. Clearing an input now restores the widget default,
content placed inside a component is projected into the element (a `<template>` inside
`<zitadel-auth-logout>` switches it to template mode), and the components implement the shared
config types so their inputs cannot drift from the other SDKs.
