---
"@zitadel/server": patch
---

Implement ADR 030 error-reporting foundation: `internal/errreport` capture toggles, `domain.Error` refinements (`Unwrap`, message-only `Error()`, structured `LogValue` with `Origin`), and instrumentation wiring for location/stack/GCP reporting.
