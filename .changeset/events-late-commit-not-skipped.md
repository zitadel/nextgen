---
"@zitadel/server": patch
---

Event webhook and stdout sinks no longer miss an event whose write commits after a later one, and paging `GET /events?order=asc` forward no longer skips it.
