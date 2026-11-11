---
"@zitadel/server": minor
---

`server.lifecycle` (`NEXTGEN_SERVER_LIFECYCLE`) tells the server how its platform keeps the process running: `always_on` (the default), `scale_to_zero` (Knative) or `request_only` (a Vercel function, Cloud Run by default). The server then picks the defaults that fit and refuses to start with background work it could not run there ([Where the server runs](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md#where-the-server-runs)).
