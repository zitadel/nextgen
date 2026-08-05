---
"@zitadel/server": minor
---

You can now list the teams of a project with `POST /teams/query`. Pass the project as the required `project_id` query parameter, page through results with `limit` and `page_token`, and filter or sort by `createdAt`. Every team in the result carries its `status`, and deactivated teams are returned alongside active ones. The endpoint needs the same read access as `GET /teams/{team_id}`.
