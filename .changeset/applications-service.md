---
"@zitadel/server": minor
---

`POST /applications` creates or revises an application and returns each new client's secret once, and `GET /applications/{id}` returns the application at its newest revision. The `Idempotency-Key` header is accepted but not used yet.
