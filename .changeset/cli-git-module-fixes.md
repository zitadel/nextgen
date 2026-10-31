---
"@zitadel/cli": patch
---

`zitadel setup` no longer commits local edits to files marked `skip-worktree` or `assume-unchanged`, never writes a secret's contents into `.git/objects`, and leaves `.env` files and `.zitadel/secret` out of its commit whatever their case. It refuses a merge, rebase or detached HEAD before writing anything. `deploy --json` keeps each file's patch with the right file when `diff.submodule` is set.
