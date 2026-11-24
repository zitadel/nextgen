---
"@zitadel/sdk-react": minor
"@zitadel/sdk-core": minor
"@zitadel/cli": minor
---

`@zitadel/sdk-react` now tells your own components who is signed in: the `useSession()` hook returns the session's status and the user's identity, shares one server read across the page and offers `refresh()`. `getSession()` gives the same answer outside React, and `@zitadel/sdk-core/session` carries it for other SPA SDKs. `zitadel setup` points React apps' agents at the hook.
