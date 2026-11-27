---
"@zitadel/api": minor
"@zitadel/components": patch
"@zitadel/testing": minor
"@zitadel/sdk-core": minor
---

Every `@zitadel/api` request now takes its settings from one immutable `ZitadelClient`, so two clients on a page, such as an app's own and the sign-in widget's, can no longer leak a timeout, abort signal or token into each other's requests.

**Breaking:** every generated operation takes its client as the first argument (`getProject(client, projectId)`), and calling one without it does not compile. `createZitadelClient(options)` is replaced by `createZitadelApi(new ZitadelClient({ baseUrl, token }))`, which binds every operation to one client. `pagedFunctions[name].withToken` takes and returns the generated function's full arguments, its client first. `getApi(project)` still binds every operation to the project's client, and `getClient(project)` returns that client. `setProxyPath`, `getProxyPath`, `getApiBaseUrl`, `setRequestPolicy`, `createApi` and the `@zitadel/api/runtime/auth` entry (`setApiAuthToken`, `setApiCsrfToken`, `setApiCsrfRejectionHandler` and their getters) are removed, and so is `CSRF_HEADER` from `@zitadel/api/runtime/fetch`: the client knows nothing of CSRF, and an app that needs the header passes its own `fetch` to the client. A client's `onRequest` runs before every request with the operation's name, URL and request, and stops the request by throwing. The generated `get…Url` builders are no longer exported; call the operation, which builds its own URL. `getApi(project)`, in `@zitadel/api/config` and re-exported by `@zitadel/sdk-core`, therefore no longer carries them, and it gains a `client` property holding the `ZitadelClient` every operation runs against. In `@zitadel/testing`, `ConnectedZitadel.api` and the seeding helpers take the bound `ZitadelApi` type, which `@zitadel/api/client` no longer calls `ZitadelClient`.
