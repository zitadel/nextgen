---
"@zitadel/cli": minor
---

`env add` now says that the environment it bound has no deployment yet, so it serves the server's own defaults rather than the `.zitadel/` files in the repository, and names the `deploy` that fixes it. A person at a terminal is asked whether to run that deploy against the environment just written; `--json`, `--non-interactive` and CI are never asked and never deploy. A failed deploy is a warning naming the command to re-run, never a failed `env add`.
