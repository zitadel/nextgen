---
"@zitadel/api": minor
---

`@zitadel/api/runtime/paging` now exports one class, `Paging`, in place of `pages()`, `nextToken()` and `itemsOf()`. Build one from a list's page readers, or with `Paging.byField()` from the names of its fields, then call `walk()` to fetch the pages, which tells your fetch function which page it is on, and `collect()` to gather them.
