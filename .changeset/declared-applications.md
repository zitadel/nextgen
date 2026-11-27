---
"@zitadel/server": minor
"@zitadel/cli": minor
"@zitadel/config": minor
---

A release can declare applications: `POST /releases/build` takes `applications`, served by the deployments of that release ([docs](https://preview.zitadel.com/docs/reference/api/releases/buildRelease)), and a deploy is refused while a declared client's `${{ NAME }}` secret variable has no value, holds a plain value, or holds a secret that is empty or not a string. `GET /applications/revisions/{revision_id}` reads what a release pins, and the console's release detail lists the applications and OAuth settings it pins.

`zitadel deploy` sends the applications under `.zitadel/applications/<slug>.json` with the release, and `deploy --dry-run` shows an added, changed or removed application in its diff. Before anything is uploaded, a deploy refuses a file that breaks the application schema, a client without a `client_id`, a confidential client that does not name its secret as a `${{ NAME }}` variable, two files with one slug, two clients with one `client_id`, and a secret variable another client or a connection names, and it refuses a secret variable the project lacks or holds as a plain value. `setup` copies the schema to `.zitadel/meta/application.json`, so editors check the file's shape. `@zitadel/config` exports `applicationConfigSchema` and `declaredApplicationIssues`.
