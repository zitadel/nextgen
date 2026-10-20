---
"@zitadel/api": minor
"@zitadel/server": minor
---

`POST /users/query` takes an optional `project_id`, so a Console session can list the users of the project it selected rather than only those of the project it signed in to. Without it, the credential's own project is listed, as before. In the generated client, `queryUsers` gains a `params` argument before the fetch options: move options passed second to the third argument.
