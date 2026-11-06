---
"@zitadel/server": minor
"@zitadel/cli": minor
---

`PATCH /users/{user_id}` takes `dry_run` in its body to check an update or schema migration without changing anything, and `zitadel users update --dry-run` asks the server the same question. See [Migrate users between schema revisions](https://preview.zitadel.com/docs/guides/migrate-user-schema).

**Breaking:** `zitadel users update --dry-run` now calls the server, so it needs a server and a credential. A failure inside an array item now names the item in `details.details.fields`, such as `attributes.phones.0.fax` instead of `attributes.phones`, so match those names by prefix.
