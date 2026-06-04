---
"@zitadel/components": minor
"@zitadel/sdk-next": minor
"@zitadel/sdk-core": minor
---

Wire up the end-to-end passkey registration and login flow across the
component and SDK surfaces:

- `@zitadel/components`: refresh the `<zl-passkey>` atom and the
  `<zitadel-login>` orchestrator templates (consolidated `default.liquid` +
  `layout-chrome.css`, dropped the standalone passkey-upsell/signed-in
  partials) and expand the `en`/`de` locale strings for the passkey steps.
- `@zitadel/sdk-next`: extend `auth` and the request `middleware` to drive the
  passkey register/login round-trip.
- `@zitadel/sdk-core`: adjust JWT handling to support the flow.
