---
"@zitadel/api": minor
"@zitadel/cli": patch
"@zitadel/config": patch
"@zitadel/testing": patch
---

Every paged list method of the [`@zitadel/api` client](https://preview.zitadel.com/docs/sdks/api-client) now has `items()`, `pages()` and `all()`, which follow the cursor for you, and `createZitadelClient` takes `onResponse` and `onError` hooks. The CLI no longer stops `--all`, the resource list commands or `zitadel api --paginate` when a server sends the same page cursor twice: that is a server bug, and the client trusts the paging contract. `deploy`, `preview`, `release create` and `setup`'s first deploy check the release body against the API's own schema before sending it, and name each field it refuses. `@zitadel/testing` no longer re-checks the ids the server answers its bootstrap and seeding with. `@zitadel/config`'s `getDefaultHumanUserSchema` is typed as the user schema document it returns, `$id` included, and exports that type as `UserSchemaDocument`; `getDefaultHumanUserSchemaBody` returns it without `$id`, as the create body takes it.
