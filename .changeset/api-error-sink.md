---
"@zitadel/server": minor
---

Every error the API returns is now logged once, as an `api error` line with the status, the operation and the error's code, message and cause. A 5xx is logged at `ERROR`, and only these lines carry the error's location and stack trace, when `instrumentation.log.errors.report_location` and `instrumentation.log.errors.stack_trace` are on (the default). A 4xx is logged at `INFO` with the code, message and cause only, and a 5xx for a request the client gave up on at `WARN`, also without location and stack. A handler that panics before its response started now answers `500` with the standard `internal` error instead of closing the connection, and is logged as an `api error` at `ERROR` with the panic's stack trace. A panic after the response started still closes the connection, so the client never takes the cut-off response for a success.
