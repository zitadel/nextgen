# ADR 016: Global SDK Configuration for the Client SDK

> **Status:** Accepted
> **Date:** 2026-05-28
> **Context:** SDK client initialization and shared component configuration

## Context

The generated API client (`@zitadel/api-client`) uses a module-level
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
| `post-sign-in-url`     | Per-page  | `<zitadel-login>` attribute               |
| `post-sign-out-url`    | Per-page  | `<zitadel-logout>` attribute              |
| `session-exchange-path`| Per-widget| `<zitadel-login>` attribute               |
| `purpose`              | Per-use   | `<zitadel-login>` attribute               |

The first two are constants that never change between pages — yet they
must be specified on every component instance. This is both repetitive and
error-prone (typo in one place silently breaks that page).

### Precedent: explicit SDK initializers

Most client SDKs with multiple services solve this with a single,
explicit initialization call at the app entry point. The `initSDK()`
call returns a config instance, from which services are derived:

```ts
// lib/sdk.ts — runs once, imported from the entry point
const app = initSDK({ apiKey: "...", projectId: "..." });
export const auth = getAuth(app);
export const db   = getDB(app);
```

Key design properties:

1. **Returns a value** — consumers import the returned object, not a
   side-effect import. This is self-documenting and tree-shakeable.
2. **Derived services** — each service (`auth`, `db`) has a focused,
   typed API surface. They share the base config but expose different
   capabilities.
3. **Runtime-agnostic config** — the config object is pure data that
   can be imported from both server and client runtimes.
4. **Write-once** — `initSDK()` with the same config is a no-op;
   with different config it throws.

## Decision

Introduce a write-once `configureZitadel()` function that sets app-wide
SDK configuration once at application startup and **returns the frozen
config object**. Web components and generated API functions read from
this shared config instead of relying on per-instance attributes for
app-wide values.

### Config shape

```ts
// @zitadel/api-client/config (entry point)
export interface ZitadelConfig {
  /** Proxy path for API requests (e.g. "/__nextgen"). */
  apiBase: string;

  /** Project ID passed to flow creation. */
  projectId: string;

  /**
   * Full URL of the Zitadel auth backend.
   * Used by server-side middleware for proxying and JWT verification.
   * Optional — not needed in client-only setups.
   */
  issuerUrl?: string;
}

/**
 * The initialized SDK handle — pure data. Derived services are
 * created via factory functions like getApi(app).
 */
export interface ZitadelApp {
  readonly apiBase: string;
  readonly projectId: string;
  readonly issuerUrl?: string;
}

/**
 * Sets app-wide SDK configuration and returns the frozen handle.
 * Write-once — subsequent calls with the same values return the
 * original handle; calls with different values log a warning.
 */
export function configureZitadel(config: ZitadelConfig): ZitadelApp;

/**
 * Returns a typed API client for the given app, with the base URL
 * pre-bound. Cached per app handle — safe to call multiple times.
 */
export function getApi(app: ZitadelApp): ZitadelApi;
```

### Write-once semantics with return value

```ts
let currentConfig: ZitadelConfig | null = null;

export function configureZitadel(config: ZitadelConfig): Readonly<ZitadelConfig> {
  if (currentConfig !== null) {
    if (currentConfig.apiBase === config.apiBase &&
        currentConfig.projectId === config.projectId &&
        currentConfig.issuerUrl === config.issuerUrl) {
      return currentConfig;        // ← same values: return existing
    }
    console.warn(
      `[zitadel] configureZitadel() already called with different values.`
    );
    return currentConfig;          // ← different values: warn, return existing
  }
  currentConfig = Object.freeze({ ...config });
  setApiBaseUrl(config.apiBase);
  return currentConfig;            // ← first call: return new frozen config
}
```

```ts
// src/zitadel.ts — single file, imported by server and client code
import { configureZitadel, getApi } from "@zitadel/api-client/config";
import { createProxy } from "@zitadel/sdk-next/middleware";

const zitadel = configureZitadel({
  apiBase: "/__nextgen",
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "demo",
  issuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
});

export const api   = getApi(zitadel);                 // typed API client
export const proxy = createProxy(zitadel, {           // middleware handler
  protectedRoutes: ["/admin"],
  loginPath: "/login",
});
```

Consumers import the derived services — not bare side-effect imports:

```ts
import { proxy } from "./zitadel";
export { proxy };  // Next.js middleware handler
```

### Derived services

Following the init-and-derive pattern, framework SDKs expose factory
functions that derive typed service objects from the base config.
`createProxy` is the first implemented derived service:

```ts
// @zitadel/sdk-next/middleware
export type ProxyOptions = Omit<NextgenMiddlewareOptions, 'proxyPath' | 'issuerUrl'>;
export type ProxyHandler = (req: NextRequest) => Promise<NextResponse | Response>;

export function createProxy(
  config: Readonly<ZitadelConfig>,
  options?: ProxyOptions,
): ProxyHandler;
```

`createProxy` reads `apiBase` and `issuerUrl` from the config — no
duplication between the init call and the middleware setup.

Future derived services will follow the same pattern:

| Derived service    | Factory                  | Provides                        |
|--------------------|--------------------------|---------------------------------|
| `api`              | `getApi(zitadel)`        | Typed API client, base URL bound|
| `proxy`            | `createProxy(zitadel)`   | Middleware handler, route match |
| `auth` *(future)*  | `getAuth(zitadel)`       | Session helpers, user info      |

### Usage in framework adapters

**Next.js** — app creates a `zitadel.ts` init file:

```ts
// src/zitadel.ts
import { configureZitadel, getApi } from "@zitadel/api-client/config";
import { createProxy } from "@zitadel/sdk-next/middleware";

export const zitadel = configureZitadel({
  apiBase: "/__nextgen",
  projectId: process.env.NEXT_PUBLIC_ZITADEL_PROJECT_ID ?? "demo",
  issuerUrl: process.env.NEXTGEN_ISSUER_URL ?? "http://localhost:4000",
});

export const api   = getApi(zitadel);
export const proxy = createProxy(zitadel, {
  protectedRoutes: ["/admin"],
  loginPath: "/login",
});
```

Server middleware re-exports the handler, client widgets receive the
config explicitly via prop:

```ts
// src/proxy.ts (server) — thin re-export
export { proxy } from "./zitadel";
export const config = { matcher: ["/__nextgen/:path*", "/admin", "/login"] };

// src/app/login/widget.tsx (client)
const ZitadelLogin = dynamic(async () => {
  const { zitadel } = await import("@/zitadel");       // ← explicit import
  await import("@zitadel/sdk-next/client");    // ← register elements
  return () => <zitadel-login project={zitadel} post-sign-in-url="/admin" />;
}, { ssr: false });
```

No provider component needed — the layout stays a pure server component.
`@zitadel/sdk-next/client` only exports the web component
registrations; `configureZitadel` is imported directly from
`@zitadel/api-client/config`.

**Nuxt** — auto-configured in the module plugin:

```ts
// sdk-nuxt/src/runtime/plugin.ts
import { configureZitadel } from "@zitadel/api-client/config";

export default defineNuxtPlugin(() => {
  const runtimeConfig = useRuntimeConfig();
  const publicConfig = runtimeConfig.public;
  configureZitadel({
    apiBase: publicConfig.nextgenApiBase ?? "/__nextgen",
    projectId: publicConfig.zitadelProjectId ?? "",
    issuerUrl: runtimeConfig.nextgenIssuerUrl ?? "http://localhost:4000",
  });
});
```

### Web component changes

Components receive the app handle via a `config` prop and derive
the API client via `getApi(config)`:

```ts
// zitadel-login.ts — simplified
import { getApi, type ZitadelApp } from "@zitadel/api-client/config";

@property({ attribute: false }) accessor config: ZitadelApp | undefined;

private async startFlow(): Promise<void> {
  const cfg = this.config ?? getZitadelConfig();
  if (!cfg) throw new Error("config is required");
  const api = getApi(cfg);

  const wire = await api.createFlow({
    project_id: cfg.projectId,
    purpose: this.purpose,
  });
}
```

This means:

1. **`api-base` and `project-id` attributes become optional** — when
   `configureZitadel()` was called, components read from the shared
   config. Attributes still work as overrides for edge cases.
2. **`connectedCallback` no longer mutates global state** — removing
   the `setApiBaseUrl()` side-effect from component lifecycle.
3. **`session-exchange-path` stays as a widget attribute** — it's
   specific to `<zitadel-login>`'s handoff logic, not app-wide config.

### What stays on the component

Per-page, per-widget, and per-instance attributes remain on the
components — they are not app-wide config:

- `post-sign-in-url` — varies between login pages
- `post-sign-out-url` — varies between logout placements
- `session-exchange-path` — widget-specific handoff routing
- `purpose` — `"login"` vs `"register"` per instance
- `resume-flow-id` — session-specific
- `locale` — can vary per component

### Server/client runtime split

`configureZitadel()` is safe to call on both runtimes:

| Runtime       | What happens                                              |
|---------------|-----------------------------------------------------------|
| **Server**    | Sets a module-level string. Harmless — nobody reads it.   |
| **Client**    | Sets the API base URL and stores config for web components.|

The config object is pure data — no DOM, no browser APIs. This lets a
single `zitadel.ts` file be imported from both server middleware and
client widgets without runtime errors.

### Migration path

1. `configureZitadel()` is introduced; `setApiBaseUrl()` becomes
   internal (not exported from the package's public API).
2. Web components check `getZitadelConfig()` — if present, use it for
   `apiBase` and `projectId`; if absent, fall back to attributes
   (current behaviour).
3. After one release cycle, bare `api-base` / `project-id` attributes
   without prior configuration emit a deprecation warning.

## Consequences

- **Single source of truth** — one place in the app declares SDK config;
  no more repeating `api-base="/__nextgen" project-id="proj_..."` on
  every component instance.
- **Init-and-derive DX** — `const zitadel = configureZitadel({...})`
  returns a handle; `getApi(zitadel)` and `createProxy(zitadel)` derive
  typed service objects from it.
- **Symmetric factories** — every service follows the same pattern:
  `getApi(app)`, `createProxy(app)`, future `getAuth(app)`.
- **Explicit data flow** — components receive the project handle via
  `project={zitadel}` prop; API calls go through `getApi(project)` —
  no hidden global reads.
- **Cached services** — `getApi(app)` uses a WeakMap cache so the same
  app always returns the same API client instance.
- **Framework SDKs handle config automatically** — end users configure
  the middleware/plugin and everything downstream just works.
- **Generated API functions are always safe to call** — no dependency on
  component mount order.
- **Write-once prevents accidental overwrites** — subsequent calls with
  different values are warned and ignored; same-value calls are no-ops
  (safe for HMR and strict mode).
- **Runtime-agnostic** — the config object crosses the server/client
  boundary safely; `configureZitadel()` is harmless on the server.

## Future work: multi-project support

Today `configureZitadel()` is write-once — calling it with different
values logs a warning. A future evolution could support multiple
projects on the same page, mirroring named app support in other SDKs:

```ts
const projectA = configureZitadel({ apiBase: "/__nextgen", projectId: "a" });
const projectB = configureZitadel({ apiBase: "/__nextgen", projectId: "b" });

const apiA = getApi(projectA);
const apiB = getApi(projectB);
```

This would require:

- Removing the write-once guard (or adding a named registry like
  `configureZitadel(config, "secondary")`)
- Adding `getProjects()` / `getProject(name)` lookup functions
- Ensuring the generated API base URL is set per-call (already handled
  by the `bind()` wrapper in `api-factory.ts`)

## Related work

- [`packages/api/src/runtime/config.ts`](../../packages/api/src/runtime/config.ts)
- [`packages/api/src/runtime/api-factory.ts`](../../packages/api/src/runtime/api-factory.ts)
- [`packages/api/src/runtime/base-url.ts`](../../packages/api/src/runtime/base-url.ts)
- [`packages/sdk-next/src/middleware.ts`](../../packages/sdk-next/src/middleware.ts)
- [`packages/sdk-nuxt/src/runtime/plugin.ts`](../../packages/sdk-nuxt/src/runtime/plugin.ts)
- [ADR 005: Public Runtime and Private Credentials](005-public-runtime-private-credentials.md)
