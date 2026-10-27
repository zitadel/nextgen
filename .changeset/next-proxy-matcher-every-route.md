---
"@zitadel/cli": patch
"@zitadel/sdk-next": patch
---

Adding a route to `protectedRoutes` alone now requires a sign-in on it: `zitadel setup` writes a Next.js `proxy.ts` (`middleware.ts` on Next.js 15) whose `matcher` covers every route but Next.js's build files; before, a route missing from the `matcher` stayed public without a warning.

**Upgrading an app set up earlier:** it keeps its `matcher`; replace it with `["/((?!_next/static|_next/image|favicon.ico).*)"]`, or add each protected route to it.
