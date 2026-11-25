---
title: zitadel setup ends with a deployed release
summary: zitadel setup now deploys .zitadel/ to your app's origin once it has committed the project, so the sign-in it asks you to verify is served the release it built.
date: 2026-11-01T21:16Z
pulls: [2461, 2495]
---

`zitadel setup` now deploys `.zitadel/` to your app's origin once it has committed the project, so the sign-in it asks you to verify is served the release it built. With `--json`, `data.deployment` reports what it deployed. A failed deploy is a warning, and its `next_commands` lead with the `zitadel deploy` that fixes it.

The commit before it is safer too:

- `setup` never commits local edits to files marked `skip-worktree` or `assume-unchanged`, never writes a secret's contents into `.git/objects`, and leaves `.env` files and `.zitadel/secret` out of its commit whatever their case.
- It refuses a merge, a rebase or a detached HEAD before writing anything.

[The quickstart](https://preview.zitadel.com/docs/get-started/quickstart)
