---
title: Review what a deploy changes from a script or an agent
summary: zitadel deploy --dry-run --json now reports the diff the terminal shows, and zitadel setup commits the project it scaffolds, so a release records its commit and a later deploy shows a real diff.
date: 2026-10-29T07:54Z
pulls: [2288, 2321]
---

`zitadel deploy --dry-run --json` now reports what the deploy would change, so a script or an agent can review it before deploying. `data.diff` lists each changed file under `.zitadel/` with its status and its part of the diff the terminal shows, against the release your primary origins serve. `zitadel deploy --json` reports the same diff for what it deployed.

`zitadel setup` now commits the project it scaffolds, initialising a repository first when there is none, so a release records the commit it was built from and a later `deploy` can show a real diff. It then points at the `deploy` that pins `.zitadel/` into a release.

Because the commit covers the project directory, `setup` refuses a repository that already has uncommitted work, untracked files included; only the `.zitadel/local/` and `.gitignore` that `zitadel start` leaves are exempt. Pass `--no-git` to skip the commit.

[The deploy guide](https://preview.zitadel.com/docs/guides/deploy)
