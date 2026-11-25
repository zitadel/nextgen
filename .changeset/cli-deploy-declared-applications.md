---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel deploy` sends the applications under `.zitadel/applications/<slug>.json` with the release, and `deploy --dry-run` shows an added, changed or removed application in its diff. Before anything is uploaded, a deploy refuses a file that breaks the application schema, a client without a `client_id`, a confidential client that does not name its secret as a `${{ NAME }}` variable, two files with one slug, and two clients with one `client_id` or one secret variable, and it refuses a secret variable the project lacks or holds as a plain value. `setup` copies the schema to `.zitadel/meta/application.json`, so editors validate the file. `@zitadel/config` exports `applicationConfigSchema` and `declaredApplicationIssues`, and its `web` preset builds a declared file when given the client id and secret variable.
