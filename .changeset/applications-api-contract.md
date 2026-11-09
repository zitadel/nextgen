---
"@zitadel/server": minor
"@zitadel/config": minor
"@zitadel/cli": minor
---

`POST /applications` registers an application with its OAuth clients, or revises one by slug, and `GET /applications/{id}` reads it ([docs](https://preview.zitadel.com/docs/reference/api/applications)). Both return not implemented until the server implements them. `zitadel setup` adds the `application.json` editor schema to `.zitadel/meta/`; in an existing project `zitadel doctor` reports it missing and `doctor --fix` writes it.
