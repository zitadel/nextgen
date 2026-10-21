---
"@zitadel/cli": minor
"@zitadel/api": minor
---

Add `zitadel api`, which calls any operation of the Zitadel API with your project's server and secret, including the ones no command covers yet. Name an operation by its `operationId` (`zitadel api queryUsers`) or its path (`zitadel api /users/query`), set query parameters and body fields with `-F name=value`, typed by the operation's schema, pass a whole body with `--input`, follow every page with `--paginate`, and preview the request as cURL with `--dry-run`. `zitadel api ls` lists the operations, and `--json` returns the response body as `data`. `@zitadel/api` exports the operations as data from `@zitadel/api/generated/operations`: each one's method, path, parameters, authentication and paging.
