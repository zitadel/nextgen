---
"@zitadel/sdk-qwik": minor
"@zitadel/cli": minor
---

`@zitadel/sdk-qwik` now targets Qwik 2: it declares a peer dependency on `@qwik.dev/core` (`^2.0.0-beta.45`) in place of `@builder.io/qwik`, so your app must be on Qwik 2 to use it. Qwik 2 runs on Vite 8. The widgets stay reactive to their props, mirroring the other framework SDKs.

The CLI's Qwik support follows suit. `zitadel setup` now scaffolds and detects Qwik 2 apps: a new app is created on `@qwik.dev/core` and Vite 8 (no Vite 7 pin), and a Qwik 1 project is no longer auto-detected, since it cannot use the Qwik 2 SDK.
