---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
---

The `@zitadel/sdk-next` middleware now asks the Zitadel server about a session only on `protectedRoutes`, and `auth()` asks when a page reads it, so a page that never calls `auth()` costs no call; `resolveSession` in `@zitadel/sdk-core` takes `checkOpaqueSession: false` to leave that check to a render layer.
