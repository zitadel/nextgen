---
"@zitadel/cli": minor
---

`env add` now says that the environment it bound has no deployment yet, so it serves the server's own defaults rather than the `.zitadel/` files in the repository, and names the `deploy` that fixes it. Interactively it offers to run that deploy against the environment it just wrote; `--json`, `--non-interactive` and CI never prompt, and `--no-deploy` stops it asking. A failed deploy is a warning naming the command to re-run, never a failed `env add`.
