---
"@zitadel/server": minor
---

Session listing moved from `GET /sessions` to `POST /sessions/query`. Pass the project as the required `project_id` query parameter, page with `limit` and `page_token`, filter on `created_at`, `user_id`, and `state`, and sort on `created_at`. The operation still answers not-implemented, so this is the contract to build against rather than a working list.
