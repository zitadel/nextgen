---
"@zitadel/server": patch
---

An authenticated request now answers `503` `unavailable` instead of `500` `internal` when the database reports a temporary failure during its credential check, so clients can retry it, and the API reference lists `unavailable` and `not_implemented` for every endpoint that checks a credential.
