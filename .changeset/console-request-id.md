---
"@zitadel/server": patch
"@zitadel/api": patch
---

The console's error screens now show the failed request's ID beside its error code, the same ID the server logs the request under, so a support request can quote it. `ApiError` from `@zitadel/api` carries it as `requestId`, read from the response's `X-Request-Id` header.

Their button now goes to Projects without the selected project, so it gets you out of a screen that fails for that project, such as a mistyped `?project=` in the address. It used to lead back to the same failing screen.
