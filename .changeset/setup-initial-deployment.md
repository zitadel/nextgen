---
"@zitadel/cli": minor
---

`setup` now commits the project it scaffolds, initialising a repository first when there is none, so a release records the commit it was built from and a later `deploy` can show a real diff. Because the commit covers the project directory, setup refuses a repository that already has uncommitted work, untracked files included; only the `.zitadel/local/` and `.gitignore` that `start` leaves are exempt. It also points at the `deploy` that pins `.zitadel/` into a release. `--no-git` opts out of the commit.
