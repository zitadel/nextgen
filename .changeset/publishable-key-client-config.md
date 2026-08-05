---
"@zitadel/api": minor
"@zitadel/server": minor
---

Add publishable-key support (ADR 036, first slice): `configureZitadel()` and the `ZitadelProject` handle accept an optional browser-safe `publishableKey`, which `getApi()` sends as the bearer on every call from that handle — enabling the browser to authenticate the handoff exchange without server-side secret injection. The server's console runtime document (`GET /console/runtime.json`) now serves the default project's publishable key (the origin-scoped preview credential, `project.read` only) alongside the project id, and the embedded console's login widget uses it.
