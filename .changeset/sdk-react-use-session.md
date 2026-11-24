---
"@zitadel/sdk-react": minor
"@zitadel/sdk-core": minor
"@zitadel/cli": minor
---

`@zitadel/sdk-react` now tells your own components who is signed in: the `useSession()` hook returns the session's status and the user's identity, shares one server read across the page and offers `refresh()`. Outside components, `sessionStore()` gives route guards and loaders the same read, and `getSession()` makes a single one. `zitadel setup` points React apps' agents at the hook.
