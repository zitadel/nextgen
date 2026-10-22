---
"@zitadel/server": patch
---

Every error the API returns is now logged once, as an `api error` line with the status, the operation and the error's code, message and cause. A 5xx is logged at `ERROR`, and only these lines carry the error's location and stack trace, when `instrumentation.log.errors.report_location` and `instrumentation.log.errors.stack_trace` are on (the default). A 4xx is logged at `INFO` with the code, message and cause only, and a request the client canceled at `WARN`, also without location and stack. A handler that panics now answers `500` with the standard `internal` error and logs its stack at `ERROR`, instead of closing the connection.
