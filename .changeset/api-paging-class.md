---
"@zitadel/api": minor
---

`@zitadel/api/runtime/paging` now exports one class, `Paging`: build one from a list's page readers, or with `Paging.byField()` from the names of its fields, then `walk()` its pages and `collect()` them.

**Breaking:** `pages()`, `nextToken()` and `itemsOf()` are removed, and a fetch function now receives the page number as a second argument. Replace `pages(fetch, { next })` with `new Paging({ items, next }).walk(fetch)`, `nextToken(page)` with `paging.next(page)`, and `itemsOf(page, field)` with `Paging.byField(field).items(page)`.
