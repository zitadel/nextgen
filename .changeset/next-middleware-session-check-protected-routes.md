---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
---

The `@zitadel/sdk-next` middleware no longer asks the Zitadel server about a signed-in visitor's session on every page. It asks on the routes in `protectedRoutes`, where it decides whether to send the visitor to the login page; on any other page, `auth()` checks the session when the page reads it. A page that never calls `auth()` now costs no call to the server, and one that does costs one call instead of two. Off a protected route, the middleware no longer clears the cookie of a session that has ended: the next protected route, sign-in or sign-out does. In `@zitadel/sdk-core`, `resolveSession` takes `checkOpaqueSession: false` to hand an opaque session token on unchecked, for a render layer that checks it itself.
