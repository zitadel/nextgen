---
"@zitadel/api-mock": patch
"@zitadel/components": patch
"@zitadel/cli": patch
---

Step `fields` and `actions` are now ordered `[{ name, ... }]` arrays on the wire (ADR 021). Templates iterate them in authorial order; the orchestrator builds `fields_by_name` / `actions_by_name` views for keyed lookups. `gates` stays a name-keyed object for now.
