---
"@zitadel/server": patch
---

A server that fails to start now reports why at `ERROR`, through the configured log format and whatever `instrumentation.log.level` is set to. Until now the reason was written at `INFO` without a source, and with the level at `warn` not at all: the process exited with status 1 and an empty log.
