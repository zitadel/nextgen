---
"@zitadel/server": patch
---

Inside a sampled trace, the `request served` line now carries the `TraceID` and `SpanID` of the request's server span, like the other lines the request writes. The IdP callback route now starts a server span of its own, so its service and storage spans are recorded under it and its request line carries the trace ID too.
