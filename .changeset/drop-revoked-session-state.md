---
"@zitadel/server": patch
---

A session's `state` is now one of `building`, `active`, or `expired`. The `revoked` state is gone from the session response and from the `state` filter of `POST /sessions/query`.