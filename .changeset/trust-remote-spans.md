---
"@zitadel/server": minor
---

A request that arrives with a W3C `traceparent` header can now continue the caller's trace instead of starting a new one. Set `instrumentation.trace.trust_remote_spans` (`NEXTGEN_INSTRUMENTATION_TRACE_TRUST_REMOTE_SPANS`) to `true` to turn it on; it was accepted before but did nothing. It is off by default, so nothing changes unless you set it. Turning it on also trusts the caller's sampled flag, which makes the request recorded whatever `instrumentation.trace.fraction` says, so use it only when ZITADEL sits behind a proxy or mesh you control.
