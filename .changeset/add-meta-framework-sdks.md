---
"@zitadel/sdk-sveltekit": minor
"@zitadel/sdk-tanstack-start": minor
"@zitadel/sdk-solid-start": minor
"@zitadel/sdk-qwik-city": minor
"@zitadel/cli": minor
---

Add SvelteKit, TanStack Start, SolidStart and Qwik City meta-framework SDKs, mirroring sdk-next and sdk-nuxt. Each ships a server integration that proxies `/__nextgen/*` to the auth backend (attaching the project service-key as the bearer), verifies the session JWT via JWKS with the Web Crypto API, and redirects unauthenticated requests on protected routes, plus a `getAuth` helper. The SvelteKit, SolidStart and Qwik City SDKs are server-only; their pages render the login, logout and session widgets with the matching framework component SDK (`@zitadel/sdk-svelte`, `@zitadel/sdk-solid`, `@zitadel/sdk-qwik`). The server glue uses each framework's native primitive: a SvelteKit `handle` hook (`createNextgenHandle`), a SolidStart `onRequest` middleware (`createNextgenMiddleware`), a Qwik City `RequestHandler` (`createNextgenOnRequest`), and a TanStack Start request middleware (`createNextgenRequestMiddleware`, with the framework-agnostic `handleNextgenRequest` core exported too). All JWT verification and proxy logic is shared from `@zitadel/sdk-core`.

`@zitadel/sdk-tanstack-start` also ships the widgets, so a TanStack Start app installs no other Zitadel package. Its `/react` entry exports `@zitadel/sdk-react`'s `ZitadelLogin`, `ZitadelLogout` and `ZitadelSession` components (every event callback, `children` slots and the signed-in session card), `businessLocales`, and every type `@zitadel/sdk-react` exports, such as `ZitadelFlowCompleteDetail` for typing a callback. Because TanStack Start server-renders every route, the components render nothing on the server and during hydration and mount right after with every prop in place, so a widget never starts a flow with its defaults. The `/client` entry exports `configureZitadel`, `getApi` and `getZitadelConfig`.

sdk-solid-start peers `solid-js` `^1.8.0`, the range `@zitadel/sdk-solid` supports.

sdk-qwik-city targets Qwik 2: it peers `@qwik.dev/core` and `@qwik.dev/router` (`^2.0.0-beta.45`), like `@zitadel/sdk-qwik`, whose widgets its pages render. A Qwik 1 City app (`@builder.io/qwik-city`) must migrate to `@qwik.dev/*` first.

The CLI now detects, scaffolds, and integrates all four meta-frameworks end to end. New detectors recognise SvelteKit (`@sveltejs/kit`), SolidStart (`@solidjs/start`), Qwik City on Qwik 2 (`@qwik.dev/router`) and TanStack Start (`@tanstack/react-start`) and run before their base-SPA detectors so a meta-framework app is no longer mistaken for a bare SPA (the React detector now also excludes TanStack Start). Each gains a scaffolder and a patcher that wires the framework-native server entrypoint (`src/hooks.server.ts`; `src/middleware.ts` registered via the `solidStart()` plugin in `vite.config.ts`; `src/routes/plugin@nextgen.ts`; and a `src/start.ts` request middleware respectively), the landing/login/register/profile routes rendering the widgets from the framework component SDK (from `@zitadel/sdk-tanstack-start/react` for TanStack Start), the public project-id env var, and the matching `@zitadel/sdk-*` dependency.
