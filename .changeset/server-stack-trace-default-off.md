---
"@zitadel/server": patch
---

Server error logs no longer include a stack trace by default. Set `instrumentation.log.errors.stack_trace: true` or `NEXTGEN_INSTRUMENTATION_LOG_ERRORS_STACK_TRACE=true` to turn it back on while debugging.
