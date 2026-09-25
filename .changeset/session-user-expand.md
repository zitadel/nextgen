---
"@zitadel/server": minor
---

A Console session can expand a user's teams and lifecycle owner team, and filter users by team, on `POST /users/query`. It used to be refused because a session carries no scopes; it is now allowed once the session may list the project's users, so the Console's Team column shows for signed-in operators.
