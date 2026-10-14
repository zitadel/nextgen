---
"@zitadel/sdk-sveltekit": patch
"@zitadel/sdk-solid-start": patch
"@zitadel/sdk-qwik-city": patch
"@zitadel/sdk-tanstack-start": patch
---

The READMEs now explain that `protectedRoutes` guards full page loads, while the `ZitadelSession`
card covers client-side navigation, and show how to guard a page on the server before it renders:
a `+page.server.ts` load in SvelteKit, a preloaded server query in SolidStart, a `routeLoader$` in
Qwik City and a `beforeLoad` server function in TanStack Start. The TanStack Start `src/start.ts`
example now registers `createCsrfMiddleware` ahead of auth, since adding that file turns off
TanStack Start's automatic CSRF protection for server functions.
