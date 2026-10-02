---
"@zitadel/server": patch
---

Ordering a list endpoint by a filter-only field (a computed predicate that has no sortable value, such as the session `has_verified_factors` state) now fails with a typed, self-explanatory error instead of crashing the request. The rule is enforced at the schema layer, so it holds across every dialect.
