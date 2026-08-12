---
"@zitadel/server": minor
---

The console now has Teams screens. The directory lists every team in the project with its status and creation date, walking the rest with `Load more`. Opening a team shows its id and creation date beside the name, and its name can be edited and saved. `Add` opens a drawer that creates a team. Search and the status tabs are not built yet: the team query endpoint filters on creation date only, so both would narrow the loaded page while appearing to narrow the whole set.
