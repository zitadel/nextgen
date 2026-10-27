---
"@zitadel/server": patch
---

A server that fails to start now logs why at `ERROR`, in the configured log format, so the reason also shows with `instrumentation.log.level: warn`, where it used to be logged at `INFO` or, at that level, not at all.
