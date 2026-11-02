---
title: Page through any list with the API client
summary: Every paged list method of @zitadel/api now has items(), pages() and all(), which follow the cursor for you, and createZitadelClient takes onResponse and onError hooks.
date: 2026-11-01T21:16Z
pulls: [2527]
---

Every paged list method of the `@zitadel/api` client now has `items()`, `pages()` and `all()`, which take the same arguments and follow the cursor for you. `items()` and `pages()` fetch the next page only when the loop reaches it, so a loop that stops early reads nothing more.

```ts
for await (const deployment of client.listDeployments.items({ project_id })) {
  if (deployment.status === "live") break; // later pages are never fetched
}

const schemas = await client.listSchemas.all({ project_id, limit: 100 });
```

- `createZitadelClient` takes `onResponse` and `onError` hooks, which see every call, each page included.
- `@zitadel/api/client` exports `pagedFunctions`: each paged function's typed readers of a page's items and cursor, and the arguments of its next page.
- `zitadel deploy`, `preview`, `release create` and the first deploy of `setup` check the release against the API's own schema before sending it, and name each field it refuses.

[The API client](https://preview.zitadel.com/docs/sdks/api-client)
