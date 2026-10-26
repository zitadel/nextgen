---
"@zitadel/cli": minor
---

`setup` now ends with an initial deployment, so a project serves the `.zitadel/` it just wrote instead of the fallback resources the server seeds beside it. Before building that release it commits what it wrote — initialising a repository first when there is none — so the release records a commit and the next `deploy` can show a real diff. Because it commits the whole tree, it refuses a repository that already has uncommitted work, untracked files included; changes the CLI made itself never count. `--no-git` and `--no-deploy` opt out of either step.
