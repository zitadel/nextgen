---
title: In Next.js, protectedRoutes alone protects a route
summary: Adding a route to protectedRoutes now requires a sign-in on it, where a route missing from the middleware's matcher used to stay public, and pages that never read the session cost no call to Zitadel.
date: 2026-10-27T23:26Z
pulls: [2372, 2374]
---

Adding a route to `protectedRoutes` alone now requires a sign-in on it. `zitadel setup` writes a Next.js `proxy.ts`, or `middleware.ts` on Next.js 15, whose `matcher` covers every route but Next.js's build files. Before, a route missing from the `matcher` stayed public without a warning.

The `@zitadel/sdk-next` middleware also asks the Zitadel server about a session only on `protectedRoutes`, and `auth()` asks when a page reads it, so a page that never calls `auth()` costs no call. `resolveSession` in `@zitadel/sdk-core` takes `checkOpaqueSession: false` to leave that check to a render layer.

## Upgrading an app set up earlier

It keeps its `matcher`. Replace it with `["/((?!_next/static|_next/image|favicon.ico).*)"]`, or add each protected route to it.

[The Next.js SDK](https://preview.zitadel.com/docs/sdks/next)
