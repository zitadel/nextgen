---
"@zitadel/cli": minor
---

`setup` now commits the project it scaffolds, initialising a repository first when there is none, so the first release records a commit and a later `deploy` can show a real diff. Because the commit covers the whole project directory, setup refuses a repository that already has uncommitted work, untracked files included; changes the CLI made itself never count. It also says that nothing is deployed yet and names the `deploy` that publishes `.zitadel/`. `--no-git` opts out of the commit.
