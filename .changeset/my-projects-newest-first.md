---
"@zitadel/server": minor
"@zitadel/api": minor
---

The console's Projects list now reads newest first, so a project you just created heads the list instead of waiting behind `Load more`. `GET /users/me/projects` takes `order` (`desc` or `asc`, by `created_at`), and `listMyProjects()` in `@zitadel/api` accepts it; without it the list stays ordered by project ID. Send the same `order` with every `page_token`: a token used under another order is refused with `400`.
