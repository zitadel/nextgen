---
"@zitadel/server": minor
---

`POST /sessions/query` now returns real results instead of not-implemented. Filter on `created_at`, `user_id`, and `state`, sort on `created_at` or `user_id` (newest first by default), and page with `limit` and `page_token`.