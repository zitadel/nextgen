---
"@zitadel/cli": minor
---

The dev proxies `zitadel setup` writes for React, Vue, Angular, Solid, Svelte
and Qwik apps now keep the app's session in a cookie named after its project,
`__nextgen_session_<project id>`, as the server SDKs do. On `localhost`, signing
in to such an app no longer signs you out of the Console of `zitadel start`, and
signing in to the Console no longer signs you out of the app. The project comes
from `ZITADEL_PROJECT_ID` in `.env.local`; without it the proxy passes cookies
through as before.

For an app set up with an earlier CLI, `zitadel setup` or `zitadel doctor --fix`
adds this to the dev proxy it wrote, and `zitadel doctor` warns until then. A dev
session from before the change is not carried over, so sign in to the app once
more.
