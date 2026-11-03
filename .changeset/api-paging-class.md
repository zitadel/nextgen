---
"@zitadel/api": minor
---

`@zitadel/api/runtime/paging` now exports one class, `Paging`: build one from a list's page readers, or with `Paging.byField()` from the names of its fields, then `walk()` its pages and `collect()` them.

It replaces `pages()`, `nextToken()` and `itemsOf()`: use `new Paging({ items, next }).walk(fetch)`, `paging.next(page)` and `Paging.byField(field).items(page)`. A fetch function now also receives the page number as a second argument.
