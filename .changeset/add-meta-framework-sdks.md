---
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-qwik-city": minor
"@zitadel/cli": minor
---

Add SvelteKit, TanStack Start, SolidStart and Qwik City meta-framework SDKs, mirroring sdk-next and sdk-nuxt. Each ships a server integration that proxies `/__nextgen/*` to the auth backend (attaching the project service-key as the bearer), verifies the session JWT via JWKS with the Web Crypto API, and redirects unauthenticated requests on protected routes, plus a `getAuth` helper and re-exports of the `zitadel-login`/`zitadel-logout` web components. The server glue uses each framework's native primitive: a SvelteKit `handle` hook (`createNextgenHandle`), a SolidStart `onRequest` middleware (`createNextgenMiddleware`), a Qwik City `RequestHandler` (`createNextgenOnRequest`), and a TanStack Start request middleware (`createNextgenRequestMiddleware`, with the framework-agnostic `handleNextgenRequest` core exported too). All JWT verification and proxy logic is shared from `@zitadel/sdk-core`. sdk-tanstack-start additionally exposes typed React widget wrappers on its `/react` entry like sdk-next.

The CLI now detects, scaffolds, and integrates all four meta-frameworks end to end. New detectors recognise SvelteKit (`@sveltejs/kit`), SolidStart (`@solidjs/start`), Qwik City (`@builder.io/qwik-city`) and TanStack Start (`@tanstack/react-start`) and run before their base-SPA detectors so a meta-framework app is no longer mistaken for a bare SPA (the React detector now also excludes TanStack Start). Each gains a scaffolder and a patcher that wires the framework-native server entrypoint (`src/hooks.server.ts`, `src/middleware.ts` + `app.config.ts`, `src/routes/plugin@nextgen.ts`, and a global request middleware respectively), the landing/login/register/profile routes rendering the widgets, the public project-id env var, and the matching `@zitadel/sdk-*` dependency.
