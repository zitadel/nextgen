# ADR 016: Global SDK Configuration for the Client SDK

> **Status:** Proposed
> **Date:** 2026-05-28
> **Context:** SDK client initialization and shared component configuration

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

Beyond the API base URL, several properties are **app-wide constants** that
are currently duplicated on every component instance:

| Config                 | Scope     | Current home                              |
|------------------------|-----------|-------------------------------------------|
| `api-base`             | App-wide  | `setApiBaseUrl()` global singleton        |
| `project-id`           | App-wide  | Repeated on every `<zitadel-login>`       |
| `session-exchange-path`| App-wide  | Repeated on `<zitadel-login>`             |
| `post-sign-in-url`     | Per-page  | `<zitadel-login>` attribute               |
| `post-sign-out-url`    | Per-page  | `<zitadel-logout>` attribute              |
| `purpose`              | Per-use   | `<zitadel-login>` attribute               |

The first three are constants that never change between pages — yet they
must be specified on every component instance. This is both repetitive and
error-prone (typo in one place silently breaks that page).

### Precedent: explicit SDK initializers

Most client SDKs with multiple services solve this with a single,
explicit initialization call at the app entry point. The pattern is:

```ts
// lib/sdk.ts — runs once, imported from the entry point
const client = initSDK({ projectId: "...", apiBase: "..." });
```

All downstream service calls reference the initialized client. If a
service is invoked before initialization, the SDK throws a clear error
instead of silently using empty defaults.

## Decision

Introduce a write-once `configureNextgen()` function that sets app-wide
SDK configuration once at application startup. Web components and
generated API functions read from this shared config instead of relying
on per-instance attributes for app-wide values.

### Config shape

```ts
// @zitadel-nextgen/api/config (new entry point)
export interface NextgenConfig {
  /** Proxy path for API requests (e.g. "/__nextgen"). */
  apiBase: string;

  /** Project ID passed to flow creation. */
  projectId: string;

  /**
   * Path for the handoff exchange request.
   * Defaults to `/sessions/exchange`, prefixed by `apiBase`.
   */
  sessionExchangePath?: string;
}

/**
 * Sets app-wide SDK configuration. Write-once — subsequent calls with
 * the same values are no-ops; calls with different values log a warning
 * and are ignored. This prevents accidental overwrites while remaining
 * safe for HMR and framework double-mounts.
 */
export function configureNextgen(config: NextgenConfig): void;

/**
 * Returns the current config, or `null` if `configureNextgen()` has
 * not been called yet.
 */
export function getNextgenConfig(): Readonly<NextgenConfig> | null;
```

### Write-once semantics

```ts
let currentConfig: NextgenConfig | null = null;

export function configureNextgen(config: NextgenConfig): void {
  if (currentConfig !== null) {
    // Same values → no-op (safe for HMR / React strict mode double-mount)
    if (currentConfig.apiBase === config.apiBase &&
        currentConfig.projectId === config.projectId) {
      return;
    }
    console.warn(
      `[nextgen] configureNextgen() already called with different values. ` +
      `Ignoring: ${JSON.stringify(config)}`
    );
    return;
  }
  currentConfig = Object.freeze({ ...config });
  setApiBaseUrl(config.apiBase);
}
```

### Usage in framework adapters

The framework SDKs (`sdk-next`, `sdk-nuxt`) call `configureNextgen()`
internally from their middleware/plugin setup, so end users configure
once and everything downstream just works:

**Next.js** — the middleware already knows the proxy path and project ID:

```ts
// sdk-next — client-side initializer called from the SDK's client entry
import { configureNextgen } from "@zitadel-nextgen/api/config";

configureNextgen({
  apiBase: "/__nextgen",
  projectId: runtimeConfig.projectId,
});
```

**Nuxt** — called from the module plugin:

```ts
// sdk-nuxt/src/runtime/plugin.ts
import { configureNextgen } from "@zitadel-nextgen/api/config";

export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig().public.nextgen;
  configureNextgen({
    apiBase: config.apiBase,
    projectId: config.projectId,
  });
});
```

### Web component changes

Once `configureNextgen()` exists, web components read app-wide config
from the shared config and only use attributes as per-instance overrides:

```ts
// zitadel-login.ts — simplified connectedCallback
override firstUpdated(): void {
  const config = getNextgenConfig();

  // App-wide values: config takes precedence, attribute is a fallback
  const apiBase = config?.apiBase ?? this.apiBase;
  const projectId = config?.projectId ?? this.projectId;

  if (apiBase) setApiBaseUrl(apiBase);
  // ...use projectId for startFlow()
}
```

This means:

1. **`api-base` and `project-id` attributes become optional** — when
   `configureNextgen()` was called, components read from the shared
   config. Attributes still work as overrides for edge cases.
2. **`connectedCallback` no longer mutates global state** — removing
   the `setApiBaseUrl()` side-effect from component lifecycle.
3. **Clear error if not configured** — `getApiBaseUrl()` throws
   (or `console.error`s) if neither `configureNextgen()` nor the
   component's `api-base` attribute was set.

### What stays on the component

Per-page and per-instance attributes remain on the components — they
are not app-wide config:

- `post-sign-in-url` — varies between login pages
- `post-sign-out-url` — varies between logout placements
- `purpose` — `"login"` vs `"register"` per instance
- `resume-flow-id` — session-specific
- `locale` — can vary per component

### Migration path

1. `configureNextgen()` is introduced; `setApiBaseUrl()` is deprecated
   but continues to work.
2. Web components check `getNextgenConfig()` — if present, use it for
   `apiBase` and `projectId`; if absent, fall back to attributes
   (current behaviour).
3. After one release cycle, `setApiBaseUrl()` is removed and bare
   `api-base` / `project-id` attributes without prior configuration
   emit a deprecation warning.

## Consequences

- **Single source of truth** — one place in the app declares SDK config;
  no more repeating `api-base="/__nextgen" project-id="proj_..."` on
  every component instance.
- **Framework SDKs handle config automatically** — end users configure
  the middleware/plugin and everything downstream just works.
- **Generated API functions are always safe to call** — no dependency on
  component mount order.
- **Write-once prevents accidental overwrites** — subsequent calls with
  different values are warned and ignored; same-value calls are no-ops
  (safe for HMR and strict mode).
- **Breaking change gated by deprecation** — attributes and
  `setApiBaseUrl()` continue working during the migration period.
- **Aligns with industry patterns** — explicit SDK initialization is the
  established convention across major client SDKs.

## Open questions

- Should `configureNextgen()` accept additional config (e.g. default
  `credentials` mode, custom `fetch` implementation, locale)?
- How does this interact with SSR? The middleware runs server-side, but
  `getNextgenConfig()` is needed client-side. The config needs to be
  serialized to the client (e.g. via Nuxt's `useRuntimeConfig` or a
  `<script>` tag injected by the middleware).

## Related work

- [`packages/api/src/runtime/base-url.ts`](../../packages/api/src/runtime/base-url.ts)
- [`packages/sdk-next/src/middleware.ts`](../../packages/sdk-next/src/middleware.ts)
- [`packages/sdk-nuxt/src/runtime/plugin.ts`](../../packages/sdk-nuxt/src/runtime/plugin.ts)
- [ADR 005: Public Runtime and Private Credentials](005-public-runtime-private-credentials.md)
