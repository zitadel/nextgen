---
"@zitadel/server": minor
"@zitadel/api": minor
---

`GET /users/me`, `PATCH /users/me` and `GET /users/me/projects` take the same
optional `project_id` as `GET /sessions/me`, and answer a session of another
project with `403 sess.project_mismatch` without reading or changing the user.
The console sends its project on these calls: when the cookie holds an app's
session instead, as on `localhost` after an app on another port signs in, the
console asks you to sign in again rather than showing that app's user or
projects.

In `@zitadel/api`, `getMyUser()` and `patchMyUser()` now take their query
parameters before the request options: call `getMyUser(undefined, init)` and
`patchMyUser(body, undefined, init)` where you passed `init` directly.
