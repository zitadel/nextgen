---
"@zitadel/server": patch
---

Events from the API (`GET /api/v1/events`) now carry `occurred_at` and `created_at` to the millisecond instead of whole seconds, so the console's sign-in timeline shows how long each step really took.
