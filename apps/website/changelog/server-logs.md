---
title: A log line per request, and every API error logged once
summary: The server logs one line per request and every error it returns once, keeps stack traces for when you ask, honours the log streams you list, and can continue a caller's trace.
date: 2026-10-27T10:33Z
cloud: true
pulls: [2252, 2254, 2345, 2352, 1410, 1469]
---

A self-hosted server's logs now tell a request in one line, and an error in one more.

- One `INFO` line per request, `request served`, with its method, its path without the query, its operation id, status, size and duration and, inside a sampled trace, `TraceID` and `SpanID`. The `handling request` line and the `error_code` field are gone.
- Every error the API returns is logged once, as an `api error` line with the status, the operation, and the error's code, message and cause: a 5xx at `ERROR`, with its location, and a 4xx at `INFO`. A handler that panics before responding now answers `500` `internal` instead of closing the connection.
- Stack traces are off by default. Set `instrumentation.log.errors.stack_trace: true` (`NEXTGEN_INSTRUMENTATION_LOG_ERRORS_STACK_TRACE=true`) while debugging.
- Removing a stream from `instrumentation.log.streams` now drops that stream's lines, and `instrumentation.log.add_source` applies to every line.
- A server that fails to start logs why at `ERROR`, in the configured log format, so the reason also shows with `instrumentation.log.level: warn`.
- `instrumentation.trace.trust_remote_spans: true` (`NEXTGEN_INSTRUMENTATION_TRACE_TRUST_REMOTE_SPANS`) continues a caller's W3C `traceparent` trace; it was accepted before but did nothing. It trusts the caller's sampled flag over `instrumentation.trace.fraction`, so turn it on only behind a proxy or mesh you control.
