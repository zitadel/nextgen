---
"@zitadel/api": minor
"@zitadel/cli": patch
---

Every paged list method of the [`@zitadel/api` client](https://preview.zitadel.com/docs/sdks/api-client) now has `items()`, `pages()` and `all()`, which follow the cursor for you, and `createZitadelClient` takes `onResponse` and `onError` hooks. In the CLI, a server that keeps returning the same page cursor now fails with a message saying the list would never end, and `zitadel api --paginate` also refuses a server that hands back the cursor it started from.
