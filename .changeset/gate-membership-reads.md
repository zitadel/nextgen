---
"@zitadel/server": minor
---

Reading a user's team memberships now requires `team_membership.read` on top of
`user.read`, on every surface that serves them: `GET /users/{user_id}/teams`,
and `POST /users/query` when `expand` asks for `teams` or a filter selects on
`team_id`. Requesting any of them without it answers `403` rather than quietly
omitting the data or serving the filtered page.

Granular scopes are not minted yet, so an operator project secret satisfies the
requirement for now; browser-plane preview secrets do not.
