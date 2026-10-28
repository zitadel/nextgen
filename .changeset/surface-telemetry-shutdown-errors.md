---
"@zitadel/server": patch
---

Report failures to flush traces, metrics and logs when the server shuts down instead of dropping them silently, and include the trace and span ID in log lines written inside a sampled trace when `instrumentation.log.format` is not set. A failed flush now makes the server exit with code 1, also on a planned stop, for example when the OpenTelemetry collector is unreachable.
