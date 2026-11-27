---
"@zitadel/cli": minor
"@zitadel/server": minor
---

`POST /applications/query` lists a project's applications, with `slug` and `created_at` as filter and sort fields and cursor paging. The list holds the applications a release declares and the ones registered through `POST /applications`, each marked by `declared`, and never returns a client secret. `zitadel application list` and `zitadel application get <id>` read them from the CLI. See [`queryApplications`](https://preview.zitadel.com/docs/reference/api/applications/queryApplications).
