---
"@zitadel/server": minor
"@zitadel/api": minor
---

A person's access token from the platform project's authorization server, such as the one `zitadel login` keeps, is accepted on every operation that takes the project secret, except those an app's sign-in calls: auth attempts, challenges, handoffs, creating a session and claiming a project. It acts as that person, with the grants they hold. The API document now names the project secret as a scheme of its own, `pat`, a bearer token, beside `oauth2`, which describes the platform project's authorization code flow, so a generated client sees which operations take which token; the Go client's `SecuritySource` gains `Pat`. `@zitadel/api`'s operation list says which operations a person's token may call (`login`). With a person's token, `POST /projects/query` lists the projects they may act on, and `GET /users/me/projects` takes one too.
