---
"@zitadel/server": patch
---

An authenticated request now answers `503` with the code `unavailable` instead of `500` `internal` when the database reports a temporary failure while the server checks the request's credential, as Spanner does once it runs out of retries. Clients and monitoring can tell the passing outage from a server error and retry. The API reference lists `unavailable` and `not_implemented` for every endpoint that checks a credential.
