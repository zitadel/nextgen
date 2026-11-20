---
title: Follow every sign-in in the console
summary: The console's Logs screen is now Events, with a Sign-ins view that shows each sign-in's steps and how long each took, and every event names the user it concerns, so you can list what happened to one account.
date: 2026-11-13T20:30Z
cloud: true
pulls: [3050, 3027, 3006, 3012, 3061, 3100, 3004, 3052]
---

The console's Logs screen is now called Events, as `GET /events` and `zitadel event list` are, and it has a Sign-ins view: one row per sign-in, with how it ended and whose account it was. Open a sign-in to see its steps in order with the time each took. The rows of one login flow are marked together, an unfinished sign-in reads Abandoned, and users show by name instead of by ID.

Events now carry `user_id`, the user they concern, whoever acted. `GET /events?user_id=…`, `zitadel event list --filter user_id=…` and the console's User filter list what happened to one account: sign-ins with rejected passwords, sessions, credentials and changes. Events recorded before the upgrade have no `user_id`.

- A sign-in's session, token and SSO callback events carry the login flow's `flow_id`, so `GET /events?flow_id=…` returns the whole sign-in.
- Event times are to the millisecond, not whole seconds.
- Each row leads with its time. Filters fold away and take several values at once, and the API requests view has columns for a request's method, operation, status and duration. An open event sits beside the list instead of over it, so search, Live, Refresh and Export stay in reach.
- A sign-up no longer records a failed sign-in when it checks that its email is free.
- On `auth.token.issued`, `token_id` is now the credential that made the request, as on every other event. Read the issued token from `entity_id`.

[Events](https://preview.zitadel.com/docs/reference/api/events)
