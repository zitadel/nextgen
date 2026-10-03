---
"@zitadel/server": patch
---

A server that fails to start now logs why at `ERROR`, in the configured log format, so the reason also shows with `instrumentation.log.level: warn`. Until now it was logged at `INFO`, with no indication of where it came from, and with the level at `warn` not at all: the process exited with status 1 and no record of the failure.
