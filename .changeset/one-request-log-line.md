---
"@zitadel/server": minor
---

The access log now has one `INFO` line per request, `request served`, written when the request ends, with the method, the path without its query, the operation id, the status, the response size and the duration. The opening `handling request` line, the status-dependent level and the `error_code` field are gone: errors are logged as `api error` lines instead. Query values are no longer logged for any route.
