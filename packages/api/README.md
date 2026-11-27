# @zitadel/api

The generated TypeScript client for the Zitadel API, plus the runtime
configuration every SDK and the shared components build on.

## Configure once, get a typed client

`configureZitadel()` (from `@zitadel/api/config`) is the primary entry point —
it initializes app-wide SDK configuration and returns a frozen, write-once
`ZitadelProject` handle. `getApi()` returns every operation bound to its
client:

```ts
import { configureZitadel, getApi } from "@zitadel/api/config";

const project = configureZitadel({
  projectId: "proj_01HEXAMPLE",
  proxyPath: "/__nextgen", // default
});

export const api = getApi(project);
```

Every operation goes to its client's base URL — the proxy path, or a server URL —
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
`onResponse` or `onError` to `createZitadelApi`.

## One client, no shared state

A `ZitadelClient` (from `@zitadel/api/client` or `@zitadel/api/runtime/client`)
is one connection: the base URL, the bearer token, the deadline, the abort
signal, the `User-Agent`, the CSRF token's source, and whether it may run
destructive operations. It is immutable; `client.with({ ... })` returns a new
one. Nothing about a request is kept anywhere but in the client it was made
with, so two clients on one page never see each other's settings.

Every generated operation takes its client as the first argument, so a bundle
carries only the operations it imports:

```ts
import { ZitadelClient } from "@zitadel/api/runtime/client";
import { getProject } from "@zitadel/api/generated/endpoints/zitadelNextGen";

const client = new ZitadelClient({
  baseUrl: "https://zitadel.example.com",
  token: process.env.ZITADEL_PROJECT_SECRET,
  allowDestructive: false,
});
const project = await getProject(client, projectId);
```

`createZitadelApi(client)` binds every operation to one client instead, with
paging; it imports all of them. `getApi(project)` is that for the configured
project, and `getClient(project)` its client.

`allowDestructive` has no default. A client that sets it to `false` rejects a
destructive operation (every `DELETE`, and what the spec marks
`x-zitadel-destructive`) with a `DestructiveOperationError` before anything is
sent. The configured project's client allows them: signing out is a `DELETE`.

## Entry points

| Import | What it carries |
| --- | --- |
| `@zitadel/api/config` | `configureZitadel()`, `getApi()`, `getClient()` — the primary surface |
| `@zitadel/api/client` | `ZitadelClient` and `createZitadelApi()`, every operation bound to one client; `pagedFunctions`, each paged function's typed readers of a page's items and cursor and the arguments of its next page |
| `@zitadel/api/runtime/client` | `ZitadelClient` alone, for code that imports only the operations it calls |
| `@zitadel/api/generated/endpoints/zitadelNextGen` | Generated endpoint functions (orval, from the OpenAPI source), each taking its `ZitadelClient` first |
| `@zitadel/api/generated/model` | Generated request/response types |
| `@zitadel/api/generated/endpoints/zitadelNextGen.zod` | Zod schemas per endpoint |
| `@zitadel/api/generated/endpoints/zitadelNextGen.msw` | MSW handlers for tests |
| `@zitadel/api/generated/operations` | Every operation as data: method, path, parameters, authentication, paging |
| `@zitadel/api/runtime/base-url` | `API_PREFIX` and `apiBaseUrl()`, which put `/api/v1` after a base |
| `@zitadel/api/runtime/fetch` | `customFetch`, the transport every operation sends through; `ApiError`, `NetworkError`, `DestructiveOperationError` |
| `@zitadel/api/runtime/paging` | `Paging`, the cursor walk behind every paged function's `pages`, `items` and `all`: it reads a page's items and cursor, and walks and gathers a list's pages |

### CSRF token for session-cookie writes

A browser app that authenticates management calls with the session cookie (the
Console does) must send the session's CSRF token on state-changing requests.
Load it once per session from `GET /sessions/me/csrf`, passing your project as
`project_id` so that a session of another app on the same host gets none, and
give the client a `csrf` provider:

```ts
const client = getClient(project).with({
  csrf: {
    origin: window.location.origin,
    token: () => csrfToken,
    refresh: () => recheckSession(),
  },
});
```

The transport reads `token()` on every unsafe request and adds the
`X-Zitadel-CSRF` header, but only to `origin`: a request to any other host
carries none. Return `undefined` from `token()` until one is loaded. Callers
that use a project secret leave `csrf` out, and nothing is added.

The token is bound to the session cookie, which another tab can replace by
signing in again. When an unsafe request to `origin` is refused with
`403 auth.csrf_invalid`, the transport calls `refresh()` once: re-check the
session there, and return a fresh token only if it still belongs to the person
the request was made for. The request is then retried once with it; returning
`undefined` leaves it refused, so a write is never replayed under someone
else's session. `apiErrorCode(error)` from `@zitadel/api/runtime/fetch` reads
the code of an `ApiError`.

The generated files come from the OpenAPI 3.1 source in the
[`zitadel/nextgen`](https://github.com/zitadel/nextgen) repository — do not
hand-edit them; the spec is the source of truth.
