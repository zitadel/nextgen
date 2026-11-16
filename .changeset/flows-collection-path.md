---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/components": minor
"@zitadel/testing": minor
---

The flow operations now live under `/flows`, plural as every other collection:
`POST /flows`, `GET /flows/{flow_id}` and `POST /flows/{flow_id}/submit`
([API reference](https://preview.zitadel.com/docs/reference/api/flows)).
`/flow` keeps answering until 1.0.0, with a `Deprecation` header and a `Link`
to that page.

**Breaking:** `@zitadel/api`, the Go client, `<zitadel-login>`, the SDKs, the
CLI and `@zitadel/testing` of this version call `/flows`, which an earlier
server answers with `404`: upgrade a self-hosted server before the apps that
use them. If you call the HTTP API yourself, change `/flow` to `/flows` in the
three paths; nothing else in a request or a response changes. From 1.0.0 the
old paths answer `404` with `req.not_found`.
