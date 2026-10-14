---
"@zitadel/sdk-core": patch
"@zitadel/sdk-next": patch
"@zitadel/sdk-nuxt": patch
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The SvelteKit, SolidStart, Qwik City and TanStack Start proxies now attach the project secret only to the `POST /sessions/exchange` handoff, like the Next.js and Nuxt proxies, instead of to every `/__nextgen/*` request — which made the app's public proxy an open relay carrying project authority. The rule is now one shared `requiresProjectSecret` export from `@zitadel/sdk-core/middleware`, used by all six server SDKs. These four proxies also forward the identity-provider callback's redirect onto the app instead of dropping it, so SSO sign-in no longer ends on a blank page.

`protectedRoutes` and `ignoredRoutes` entries now match with or without a trailing slash, so `/profile/` can no longer bypass `protectedRoutes: ["/profile"]` — Qwik Router serves the slashed form by default. `@zitadel/sdk-solid-start`'s `SolidMiddlewareConfig.onRequest` is now a mutable array, as SolidStart 2's `createMiddleware` requires; the readonly type failed the generated `src/middleware.ts` typecheck.
