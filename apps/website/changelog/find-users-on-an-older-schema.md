---
title: Find the users still on an older schema revision
summary: POST /users/query can list the users left to migrate to a schema's newest revision, and GET /schemas can say whether any user is still on each revision.
date: 2026-10-28T09:32Z
cloud: true
pulls: [2129]
---

Users stay on the schema revision they were created on until you migrate them, and `POST /users/query` can now list the ones left. Its new `schema_object_type` filter field matches the object type every revision of a schema shares, with `equals`, `not_equals` and `contains`, and `schema` now accepts `not_equals`. So `schema_object_type` `equals` a type together with `schema` `not_equals` its newest revision lists the users still on an older one.

`GET /schemas?expand=in_use` adds `metadata.in_use` to each listed revision: whether any user of the project is on it. It needs read on the whole project, plus `user.read` for a token. Users are now indexed by schema, so this check and the `schema` filter no longer read every user of the project.

From 0.3.0, `zitadel users list --filter` accepts `schema_object_type`.

[Migrate users between schema revisions](https://preview.zitadel.com/docs/guides/migrate-user-schema), [Query users in the API reference](https://preview.zitadel.com/docs/reference/api/users/queryUsers)
