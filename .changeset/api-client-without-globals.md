---
"@zitadel/api": minor
"@zitadel/components": patch
"@zitadel/testing": minor
---

Every `@zitadel/api` request now takes its settings from one immutable `ZitadelClient`, so two clients on a page, such as an app's own and the sign-in widget's, can no longer leak a timeout, abort signal or token into each other's requests.

**Breaking:** every generated operation takes its client as the first argument (`getProject(client, projectId)`), and calling one without it does not compile. `createZitadelClient(options)` is replaced by `createZitadelApi(new ZitadelClient({ baseUrl, token, allowDestructive }))`, which binds every operation to one client; `allowDestructive` is required, and a client that sets it to `false` rejects a destructive operation with a `DestructiveOperationError` before anything is sent. `getApi(project)` is unchanged and its client allows them; `getClient(project)` returns that client. `setProxyPath`, `getProxyPath`, `getApiBaseUrl`, `setRequestPolicy`, `createApi` and the `@zitadel/api/runtime/auth` entry (`setApiAuthToken`, `setApiCsrfToken`, `setApiCsrfRejectionHandler` and their getters) are removed, and so is `CSRF_HEADER` from `@zitadel/api/runtime/fetch`: the client knows nothing of CSRF, and an app that needs the header passes its own `fetch` to the client. `get…Url` builders now return the operation's path alone. In `@zitadel/testing`, `ConnectedZitadel.api` and the seeding helpers take the bound `ZitadelApi` type, which `@zitadel/api/client` no longer calls `ZitadelClient`.
