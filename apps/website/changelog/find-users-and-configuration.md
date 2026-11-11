---
title: Find users and configuration from the console's search
summary: The console's search finds a project's users, user schemas, login flows and identity providers, and the Users list searches by identifier and filters by schema, status and creation date.
date: 2026-11-11T14:19Z
cloud: true
pulls: [2688, 2927, 2936, 2982]
---

The console's search (⌘K) now finds a project's users, user schemas, login flows and identity providers beside its teams. It also runs actions in the selected project: Add user, Add team and Copy project ID.

- The Users list searches every page by the start of a user's identifier, and one **Add filter** menu narrows it by schema, revision, status and creation date.
- A status dot says what the status means: green in force, amber suspended, red pending purge, grey off.
- A user's Authentication tab says when they cannot sign in because they hold no password, passkey or linked identity provider.
- `POST /search` answers the same search through the API, and `search()` in `@zitadel/api` calls it.
- `POST /users/query` and `zitadel users list --filter` take `identifier` with the new `starts_with` operation, which ignores case.

[The search API](https://preview.zitadel.com/docs/reference/api/search)
