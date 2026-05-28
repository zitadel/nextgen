# ADR 016: Global API Initializer for the Client SDK

> **Status:** Proposed
> **Date:** 2026-05-28
> **Context:** SDK client initialization and API base URL management

## Context

The generated API client (`@zitadel-nextgen/api`) uses a module-level
singleton to store the API base URL:

```ts
// packages/api/src/runtime/base-url.ts
let apiBaseUrl = "";

export function getApiBaseUrl(): string { return apiBaseUrl; }
export function setApiBaseUrl(baseUrl: string): void { apiBaseUrl = baseUrl; }
```

Every generated endpoint function (e.g. `getMySession()`, `revokeMySession()`)
calls `getApiBaseUrl()` internally to build request URLs.

Today, the base URL is set as a **side-effect of web component mounting**.
`<zitadel-login api-base="/__nextgen">` and `<zitadel-logout api-base="/__nextgen">`
both call `setApiBaseUrl(this.apiBase)` in their `connectedCallback`. This
means:

1. **No explicit initialization step** — the API client works only after
   a web component happens to mount on the page.
2. **Order-dependent** — if application code calls `getMySession()` before
   any web component connects, the base URL is still `""`.
3. **Mutable global** — any component can overwrite the base URL at any
   time, which is fragile in apps that render multiple components.
4. **Not discoverable** — there's no single place in the app that declares
   "here is how the SDK is configured."

### Precedent: Firebase `initializeApp()`

Firebase solves the same problem with a single, explicit initialization:

```ts
// lib/firebase.ts — runs once, imported from the app entry point
import { initializeApp } from "firebase/app";

const app = initializeApp({
  apiKey: "...",
  projectId: "...",
  authDomain: "...",
});
```

All Firebase services (`getAuth()`, `getFirestore()`, etc.) then reference
the initialized app instance. If you call a service before `initializeApp()`,
Firebase throws a clear error.

## Decision

Introduce a top-level `initNextgen()` function that configures the API
client once at application startup.

### API surface

```ts
// @zitadel-nextgen/api/init (new entry point)
export interface NextgenConfig {
  /** Proxy path for API requests (e.g. "/__nextgen"). */
  apiBase: string;
}

/**
 * Initializes the Nextgen API client. Must be called once before any
 * generated endpoint function or web component is used.
 *
 * Throws if called more than once (prevents accidental re-init).
 */
export function initNextgen(config: NextgenConfig): void;

/**
 * Returns whether initNextgen() has been called.
 */
export function isInitialized(): boolean;
```

### Usage in framework adapters

The framework SDKs (`sdk-next`, `sdk-nuxt`) would call `initNextgen()`
internally from their middleware/plugin setup, so end users don't need
to think about it:

**Next.js** — called from the middleware configuration:

```ts
// apps/demo-next/src/proxy.ts
import { nextgenMiddleware } from "@zitadel-nextgen/sdk-next/middleware";

export function proxy(req) {
  return nextgenMiddleware(req, {
    issuerUrl: process.env.NEXTGEN_ISSUER_URL,
    proxyPath: "/__nextgen",    // ← middleware already knows this
    protectedRoutes: ["/admin"],
    loginPath: "/login",
  });
}
```

The middleware already knows the `proxyPath`. A client-side counterpart
(`initNextgenClient`) could be called from the SDK's client entry point,
receiving the proxy path from a serialized runtime config.

**Nuxt** — called from the module plugin:

```ts
// sdk-nuxt/src/runtime/plugin.ts
import { initNextgen } from "@zitadel-nextgen/api/init";

export default defineNuxtPlugin(() => {
  initNextgen({ apiBase: "/__nextgen" });
});
```

### Web component changes

Once `initNextgen()` exists:

1. **`api-base` attribute becomes optional** — web components read from
   `getApiBaseUrl()` by default and only fall back to the attribute.
2. **`connectedCallback` no longer calls `setApiBaseUrl()`** — removing
   the global mutation side-effect from component lifecycle.
3. **Clear error if not initialized** — `getApiBaseUrl()` throws
   (or `console.error`s) if `initNextgen()` was never called, instead of
   silently returning `""`.

### Migration path

1. `initNextgen()` is introduced; `setApiBaseUrl()` is deprecated but
   continues to work.
2. Web components check `isInitialized()` — if true, ignore `api-base`;
   if false, fall back to `api-base` + `setApiBaseUrl()` (current behaviour).
3. After one release cycle, `setApiBaseUrl()` is removed and `api-base`
   becomes a no-op with a deprecation warning.

## Consequences

- **Explicit initialization** — one place in the app declares SDK config.
- **Framework SDKs handle init automatically** — end users configure the
  middleware/plugin and everything downstream just works.
- **Generated API functions are always safe to call** — no dependency on
  component mount order.
- **Breaking change gated by deprecation** — `api-base` and
  `setApiBaseUrl()` continue working during the migration period.
- **Aligns with industry patterns** — Firebase, Supabase, and Clerk all
  use explicit initialization.

## Open questions

- Should `initNextgen()` accept additional config (e.g. default
  `credentials` mode, custom `fetch` implementation)?
- Should the framework SDKs auto-initialize from the middleware config,
  or require an explicit `initNextgen()` call in the app entry point?
- How does this interact with SSR? The middleware runs server-side, but
  `getApiBaseUrl()` is needed client-side. The config needs to be
  serialized to the client (e.g. via `__NEXTGEN_CONFIG__` on `window`
  or Nuxt's `useRuntimeConfig`).

## Related work

- [`packages/api/src/runtime/base-url.ts`](../../packages/api/src/runtime/base-url.ts)
- [`packages/sdk-next/src/middleware.ts`](../../packages/sdk-next/src/middleware.ts)
- [`packages/sdk-nuxt/src/runtime/plugin.ts`](../../packages/sdk-nuxt/src/runtime/plugin.ts)
- [ADR 005: Public Runtime and Private Credentials](005-public-runtime-private-credentials.md)
