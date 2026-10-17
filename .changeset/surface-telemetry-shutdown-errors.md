---
"@zitadel/server": patch
---

Report failures to flush traces, metrics and logs when the server shuts down instead of dropping them silently, and include the trace and span ID in log lines written inside a sampled trace when `instrumentation.log.format` is not set.
