---
"@zitadel/server": minor
"@zitadel/api": minor
---

New endpoint `GET /users/{user_id}/teams` serves a user's team roster, so a
client can finally get from a user to the teams they belong to.

Each entry is `{ id, name, membership_status, created_at, updated_at }`. The
team's **name** travels with the entry, so a page of the roster renders without
a follow-up `POST /teams/query` per row. Entries come back ordered by team name
and page with `limit` / `page_token` like the other list endpoints;
memberships the user was removed from are not returned. An unknown user is a
404, which is a different answer from a user with an empty roster.

The user read endpoints (`GET /users`, `GET /users/{user_id}`,
`GET /users/me`) also gain `metadata.lifecycle_owner_team_id` — the single team
that owns the user's identity lifecycle, or `null` when the user is self-owned.
That is a different concept from the roster and the two need not agree
(ADR 024): roster membership is collaboration, lifecycle ownership decides who
may deprovision the user. The roster itself stays out of the user payload; it
is unbounded, so it gets its own paginated resource.
