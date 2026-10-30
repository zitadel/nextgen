---
"@zitadel/api": minor
"@zitadel/cli": patch
---

Every paged list method of the [`@zitadel/api` client](https://preview.zitadel.com/docs/sdks/api-client) now has `items()`, `pages()` and `all()`, which follow the cursor for you, and `createZitadelClient` takes `onResponse` and `onError` hooks. The CLI's `--all` and `zitadel api --paginate` page through the same code.
