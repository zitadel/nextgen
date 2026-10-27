---
"@zitadel/server": minor
---

Every error the API returns is now logged once, as an `api error` line with the status, the operation and the error's code, message and cause: a 5xx at `ERROR`, with its location and, when `instrumentation.log.errors.stack_trace` is on, its stack, and a 4xx at `INFO`. A handler that panics before responding now answers `500` `internal` instead of closing the connection.
