---
"@zitadel/server": minor
---

`POST /applications` creates or revises an application and returns each new client's secret once, and `GET /applications/{id}` returns the application at its newest revision. Each write records an `application.created` or `application.updated` event. The `Idempotency-Key` header is accepted but not used yet.
