---
title: Call any API operation from the CLI
summary: The new zitadel api command calls any operation of the Zitadel API with your project's server and secret, including the ones no command covers yet.
date: 2026-10-21T22:08Z
pulls: [2187]
---

`zitadel api` calls any operation of the Zitadel API with your project's server and secret, including the ones no command covers yet.

- Name an operation by its `operationId`, `zitadel api queryUsers`, or by its path, `zitadel api /users/query`. `zitadel api ls` lists them.
- Set query parameters and body fields with `-F name=value`, typed by the operation's schema, or pass a whole body with `--input`.
- Follow every page with `--paginate`, and preview the request as cURL with `--dry-run`.
- With `--json`, the response body comes back as `data`.

`@zitadel/api` exports the same operations as data from `@zitadel/api/generated/operations`: each one's method, path, parameters, authentication and paging.

[`zitadel api` in the CLI reference](https://preview.zitadel.com/docs/reference/cli/api)
