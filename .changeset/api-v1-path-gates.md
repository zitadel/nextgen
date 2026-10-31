---
"@zitadel/api": minor
"@zitadel/cli": minor
"@zitadel/sdk-core": minor
---

The server SDKs' `/__nextgen` proxies and the dev proxies `zitadel setup` writes for single-page apps now recognize the session calls under `/api/v1` as well as at their current paths, so sign-in keeps working once the API moves under `/api/v1`. `zitadel doctor` warns about a dev proxy an earlier `zitadel setup` wrote, and `zitadel doctor --fix` updates it. If you wrote your own production proxy for a single-page app, have it add the project secret to `POST /api/v1/sessions/exchange` as well as `POST /sessions/exchange`. `@zitadel/api` exports `API_PREFIX`, the path the API moves to.
