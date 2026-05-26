---
"@zitadel-nextgen/components": minor
"@zitadel-nextgen/sdk-next": patch
"@zitadel-nextgen/sdk-nuxt": patch
---

Replace the `@nextgen/ui-lit` placeholder web components with the real
`@zitadel-nextgen/components` library across the demos and SDK packages.

- Add `<zitadel-logout>`: an orchestrator-tier element built on the same
  design-token system as `<zitadel-login>`. It reads the `__nextgen_display`
  cookie, renders an avatar trigger + dropdown by default, and supports a
  `<template>`-slot mode with `{{name}}`, `{{email}}`, `{{initial}}`
  substitutions and `data-action="logout"` triggers. Fires `zitadel-signout`
  on completion.
- Add `proxy-base` and `post-sign-in-url` attributes to `<zitadel-login>`.
  When `proxy-base` is set the orchestrator drives a new `ProxyTransport`
  against the SDK's `/__nextgen` proxy; `post-sign-in-url` navigates after a
  terminal step. `<zitadel-logout>` exposes `proxy-base` and
  `post-sign-out-url` for the symmetric flow.
- Add `ProxyTransport`: a same-origin transport that speaks the
  `/v1/flow {action,email,password}` shape exposed by the
  `feat/sdk-packages` mock server / SDK proxy. Synthesises a single-step
  `FlowResponse` with `email` + `password` fields so the existing
  orchestrator + atom pipeline renders against it unchanged.
- Drop the `@nextgen/ui-lit` package and switch `@zitadel-nextgen/sdk-next`,
  `@zitadel-nextgen/sdk-nuxt`, and the `apps/demo-next` / `apps/demo-nuxt` apps to
  re-export and consume `@zitadel-nextgen/components` instead. Existing
  `<nextgen-login>` / `<nextgen-logout>` tags become `<zitadel-login>` /
  `<zitadel-logout>` with the same `proxy-base` and post-sign-{in,out}-url
  attributes.
