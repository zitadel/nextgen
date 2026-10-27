---
"@zitadel/cli": patch
"@zitadel/sdk-next": patch
---

`zitadel setup` now writes a Next.js `proxy.ts` (`middleware.ts` on Next.js 15) whose `matcher` covers every route but Next.js's build files, so adding a route to `protectedRoutes` is all it takes to require a sign-in. Before, a route added to `protectedRoutes` but not to the `matcher` stayed public, without a warning. The `@zitadel/sdk-next` README and skill show the same `matcher`. The session of a signed-in visitor is now checked on every page, not only on protected ones, and `auth()` sees it on every page too. Apps set up earlier keep their `matcher`: replace it with `["/((?!_next/static|_next/image|favicon.ico).*)"]`, or add each protected route to it.
