---
"@zitadel/server": minor
---

The access log now writes one `INFO` line per request, `request served`, with its method, path without the query, operation id, status, size, duration and, inside a sampled trace, `TraceID` and `SpanID`. The `handling request` line and the `error_code` field are gone; errors are logged as `api error` lines. The IdP callback now has a server span of its own.
