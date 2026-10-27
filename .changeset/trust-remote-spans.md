---
"@zitadel/server": minor
---

Set `instrumentation.trace.trust_remote_spans` (`NEXTGEN_INSTRUMENTATION_TRACE_TRUST_REMOTE_SPANS`) to `true` to continue a caller's W3C `traceparent` trace instead of starting a new one; it was accepted before but did nothing. It is off by default and trusts the caller's sampled flag over `instrumentation.trace.fraction`, so turn it on only behind a proxy or mesh you control.
