---
"@zitadel/api": minor
"@zitadel/cli": patch
---

Every paged function of the `@zitadel/api` client now carries `pages()`, `items()` and `all()`, which walk its cursor lazily: `for await (const deployment of client.listDeployments.items({ project_id }))` fetches the next page only when the loop reaches it. The walk itself is exported from `@zitadel/api/runtime/paging`. The CLI's `--all`, `--paginate` and the commands that read every deployment now page through it, and a server that repeats a page cursor is refused with "The server repeated a page cursor, so the list would never end".
