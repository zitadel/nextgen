---
"@zitadel/server": patch
---

Removing a stream from `instrumentation.log.streams` now drops that stream's log lines. Before, every stream was logged whatever the list said. `instrumentation.log.add_source` now applies to the lines written through the zlog helpers as well; before, those lines never carried a source.
