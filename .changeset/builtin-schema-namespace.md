---
"@zitadel/server": patch
"@zitadel/config": patch
"@zitadel/cli": patch
---

Built-in schemas are now named under `https://preview.zitadel.com/schemas/v1`, for example `https://preview.zitadel.com/schemas/v1/user-schema.json`, instead of `https://nextgen.com/api/schemas`, a domain Zitadel does not own. Existing projects need no change: schema files, stored schemas, users and bootstrap user documents that name the old URLs keep validating and resolving, and the server never fetches a URL in either namespace. Projects created by `zitadel setup` from now on reference the new URLs, so pair this CLI with a server from the same release.
