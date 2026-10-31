---
"@zitadel/cli": patch
---

Every command now prints its suggested next steps at the end of a run, including `deploy`, `pull`, `origin add`, `release create`, `deployment create`, `env add` and the resource commands, which used to show them only under `--json`. `env add` lists its next commands once, in that block, instead of also spelling them out in its summary. Where stdout is data a script reads (a piped list's rows, a resource's JSON body) the next steps go to stderr instead. The `--json` output is unchanged.
