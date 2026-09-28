# @zitadel/api

The generated TypeScript client for the Zitadel API, plus the runtime
configuration every SDK and the shared components build on.

## Configure once, get a typed client

`configureZitadel()` (from `@zitadel/api/config`) is the primary entry point —
it initializes app-wide SDK configuration and returns a frozen, write-once
`ZitadelProject` handle. `getApi()` returns the typed client bound to it:

```ts
import { configureZitadel, getApi } from "@zitadel/api/config";

const project = configureZitadel({
  projectId: "proj_01HEXAMPLE",
  proxyPath: "/__nextgen", // default
});

export const api = getApi(project);
```

Subsequent `configureZitadel()` calls with the same values return the original
handle; different values log a warning and keep the original — safe for HMR
and framework double-mounts. The same handle is what you pass to the shared
web components' `project` property.

## Entry points

| Import | What it carries |
| --- | --- |
| `@zitadel/api/config` | `configureZitadel()`, `getApi()` — the primary surface |
| `@zitadel/api/client` | The client wrapper the SDKs consume |
| `@zitadel/api/generated/endpoints/zitadelNextGen` | Generated endpoint functions (orval, from the OpenAPI source) |
| `@zitadel/api/generated/model` | Generated request/response types |
| `@zitadel/api/generated/endpoints/zitadelNextGen.zod` | Zod schemas per endpoint |
| `@zitadel/api/generated/endpoints/zitadelNextGen.msw` | MSW handlers for tests |
| `@zitadel/api/runtime/base-url` | `setProxyPath()` / `getProxyPath()` — the low-level slot `configureZitadel()` writes; call it directly only when you manage configuration yourself |
| `@zitadel/api/runtime/auth` | `getApiAuthToken()` and bearer plumbing |
| `@zitadel/api/runtime/fetch` | The shared `customFetch` interceptor |

The generated files come from the OpenAPI 3.1 source in the
[`zitadel/nextgen`](https://github.com/zitadel/nextgen) repository — do not
hand-edit them; the spec is the source of truth.
