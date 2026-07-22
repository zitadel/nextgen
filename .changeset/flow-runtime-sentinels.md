---
"@zitadel/server": patch
---

Migrate flow runtime errors to `flow.*` domain sentinels with fixed public messages (ADR 030). Wire codes change from ad-hoc strings (`flow_cookie_invalid`, `invalid_action`, …) to stable `flow.cookie_invalid`, `flow.invalid_action`, and related codes; API responses no longer echo wrapped `err.Error()` text for those paths.
