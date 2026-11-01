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

Every operation goes to the proxy path, or to the server URL a client is given,
followed by `/api/v1`, where the server serves the API: `getUser` calls
`/__nextgen/api/v1/users/{id}`. Give a server's origin, without `/api/v1`; one
that already ends in it keeps a single prefix. A `404` with the code
`req.not_found` means the server has no such operation: a server older than the
client does not serve the API under `/api/v1`.

Subsequent `configureZitadel()` calls with the same values return the original
handle; different values log a warning and keep the original — safe for HMR
and framework double-mounts. The same handle is what you pass to the shared
web components' `project` property.

Every paged list method also walks its cursor for you, one page at a time as
the loop asks: `client.listDeployments.items({ project_id })` yields every
deployment, `.pages(...)` every page, and `.all(...)` collects them into one
array. To change what every call returns, each page included, pass
`onResponse` or `onError` to `createZitadelClient`.

## Entry points

| Import | What it carries |
| --- | --- |
| `@zitadel/api/config` | `configureZitadel()`, `getApi()` — the primary surface |
| `@zitadel/api/client` | The client wrapper the SDKs consume; `paging`, each paged function's typed readers of a page's items and cursor and the arguments of its next page |
| `@zitadel/api/generated/endpoints/zitadelNextGen` | Generated endpoint functions (orval, from the OpenAPI source) |
| `@zitadel/api/generated/model` | Generated request/response types |
| `@zitadel/api/generated/endpoints/zitadelNextGen.zod` | Zod schemas per endpoint |
| `@zitadel/api/generated/endpoints/zitadelNextGen.msw` | MSW handlers for tests |
| `@zitadel/api/generated/operations` | Every operation as data: method, path, parameters, authentication, paging |
| `@zitadel/api/runtime/base-url` | `API_PREFIX` and `apiBaseUrl()`, which put `/api/v1` after a base; `setProxyPath()` / `getProxyPath()` — the low-level slot `configureZitadel()` writes; call it directly only when you manage configuration yourself |
| `@zitadel/api/runtime/auth` | `getApiAuthToken()` and bearer plumbing; `setApiCsrfToken()` / `getApiCsrfToken()` / `setApiCsrfRejectionHandler()` for session-cookie writes (see below) |
| `@zitadel/api/runtime/fetch` | The shared `customFetch` interceptor |
| `@zitadel/api/runtime/paging` | `pages()`, the cursor walk behind every paged function's `pages`, `items` and `all`; `nextToken()`, a page's cursor to the next one; `itemsOf()`, a page's list |

### CSRF token for session-cookie writes

A browser app that authenticates management calls with the
session cookie (the Console does) must send the session's CSRF
token on state-changing requests. Load it once per session from
`GET /sessions/me/csrf`, passing your project as `project_id` so that a session
of another app on the same host gets none, and hand it to
`setApiCsrfToken(token)`; `customFetch`
then adds the `X-Zitadel-CSRF` header to unsafe requests to that server. The
token is stored with the origin it was issued for — the page's own by default,
or `setApiCsrfToken(token, origin)` for an API on another origin — and is never
sent anywhere else. Clear it with `setApiCsrfToken(undefined)` on sign-out or
when the session changes. Callers that use a project secret leave it unset, and
nothing is added.

The token is bound to the session cookie, which another tab can replace by
signing in again. Register `setApiCsrfRejectionHandler(async () => …)` (same origin
rule, same optional second argument) for an unsafe request refused with
`403 auth.csrf_invalid`: re-check the session there,
and return a fresh token only if it still belongs to the person the request was
made for. `customFetch` then retries the request once with it; returning
`undefined` leaves it refused, so a write is never replayed under someone
else's session.
`apiErrorCode(error)` from `@zitadel/api/runtime/fetch` reads the code of an
`ApiError`. The token slot is shared across copies of this package loaded in the
same page.

The generated files come from the OpenAPI 3.1 source in the
[`zitadel/nextgen`](https://github.com/zitadel/nextgen) repository — do not
hand-edit them; the spec is the source of truth.
