---
"@zitadel/cli": minor
---

`setup` now ends with an initial deployment, so a project serves the `.zitadel/` it just wrote instead of the fallback resources the server seeds beside it. Before building that release it gives the project a git repository with one commit, when the directory is not already inside one, so the release records a commit and the next `deploy` can show a real diff. `--no-git` and `--no-deploy` opt out of either step.
