---
"@zitadel/server": patch
---

A trace exporter without `batch_duration` now sends its spans every 5 seconds, or as `OTEL_BSP_SCHEDULE_DELAY` says, instead of keeping a CPU core busy while the server is idle.
