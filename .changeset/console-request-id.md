---
"@zitadel/server": patch
"@zitadel/api": patch
---

The console's error screens now show the failed request's ID beside its error code, the same ID the server logs the request under, so a support request can quote it. `ApiError` from `@zitadel/api` carries it as `requestId`, read from the response's `X-Request-Id` header.
