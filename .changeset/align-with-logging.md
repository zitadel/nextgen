---
"@zitadel/server": patch
---

Align request logging with ADR 030: expected 4xx responses log at `Warn` with `error_code` (parsed from the wire envelope only), 5xx at `Error`, and raw response bodies are no longer written to logs.
