---
"@zitadel/server": minor
---

`POST /applications` creates or revises an application and returns each new client's secret once, and `GET /applications/{id}` returns the application at its newest revision. A release can declare applications too: `POST /releases/build` takes `applications`, served by the deployments of that release ([docs](https://preview.zitadel.com/docs/reference/api/releases/buildRelease)), and a deploy is refused while a declared client's `${{ NAME }}` secret variable has no value or holds a plain value. `GET /applications/revisions/{revision_id}` reads what a release pins, and the console's release detail lists the applications and OAuth settings it pins. Each write records an `application.created` or `application.updated` event. The `Idempotency-Key` header is accepted but not used yet.
