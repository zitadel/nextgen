---
"@zitadel/server": patch
---

Traced requests now show each database statement as its own span, so a slow
request points at the statement that took the time. When no trace exporter is
configured (`instrumentation.trace.exporter.type` unset or `none`), tracing is
now fully off and adds no cost to requests.
