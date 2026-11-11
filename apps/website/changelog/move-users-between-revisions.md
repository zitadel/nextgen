---
title: Move a user to another schema revision, and check it first
summary: The console's user page says when a newer schema revision is available and moves the user to it, and PATCH /users/{user_id} takes dry_run to check an update or a migration without changing anything.
date: 2026-11-05T21:40Z
cloud: true
pulls: [2570, 2731, 2821]
---

The console's user page now says when a newer revision of the user's schema is available, and lets you move that user to any revision of their schema. It asks only for the values the move needs.

To check a change before you make it, `PATCH /users/{user_id}` takes `dry_run` in its body: it checks an update or a schema migration and changes nothing. `zitadel users update --dry-run` asks the server the same question.

Revisions read the same way across the console:

- The Users list's revision filter picks one schema revision, or `Older revisions` for every user not yet on the newest. Its `Latest only` choice is gone: pick the newest revision instead.
- The revision menu there and on a schema's detail page shows each revision as a shortened id, its creation time, and `Latest` and `In use` badges.
- Ids too long for their slot are cut in the middle, keeping their start and the end that tells them apart, such as `user_0…PQFJA0`.

**Breaking:** `zitadel users update --dry-run` now calls the server, so it needs a server and a credential. A failure inside an array item now names the item in `details.details.fields`, such as `attributes.phones.0.fax` instead of `attributes.phones`, so match those names by prefix.

[Migrate users between schema revisions](https://preview.zitadel.com/docs/guides/migrate-user-schema)
