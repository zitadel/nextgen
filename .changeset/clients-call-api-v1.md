---
"@zitadel/api": minor
"@zitadel/cli": minor
"@zitadel/sdk-core": minor
"@zitadel/sdk-next": minor
"@zitadel/server": minor
"@zitadel/testing": minor
---

The SDKs, the login components, the console and the `zitadel` CLI now call the API under `/api/v1`, where the server serves it. `@zitadel/api`'s client puts `/api/v1` after the proxy path or server origin it is given, and keeps a single prefix when the origin already ends in it. `zitadel api` takes a path with or without the prefix and shows the full URL with it. A call the server knows no operation for now says the server may be older than the client.

**Breaking:** clients from this release need a server that serves `/api/v1`, so upgrade a self-hosted server before the apps that call it. In a single-page app set up by an earlier `zitadel setup`, run `zitadel doctor --fix`: the dev proxy it wrote adds the project secret only to the old path of the session exchange, so sign-in fails until it is updated, and `zitadel doctor` now fails on it. A production proxy you wrote for a single-page app must add the project secret to `POST /api/v1/sessions/exchange`. Until 1.0.0 the server also answers every operation at its old path, with a `Deprecation` header.
