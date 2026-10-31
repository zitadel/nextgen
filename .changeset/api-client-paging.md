---
"@zitadel/api": minor
"@zitadel/cli": patch
---

Every paged list method of the [`@zitadel/api` client](https://preview.zitadel.com/docs/sdks/api-client) now has `items()`, `pages()` and `all()`, which follow the cursor for you, and `createZitadelClient` takes `onResponse` and `onError` hooks. The CLI no longer stops `--all`, the resource list commands or `zitadel api --paginate` when a server sends the same page cursor twice: that is a server bug, and the client trusts the paging contract.
