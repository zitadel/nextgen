---
"@zitadel/cli": patch
---

`zitadel start` now restarts a local server that an earlier CLI release left
running, instead of reusing it, and keeps its data. `zitadel setup --server
local` stops before it creates anything when the local server is another
release's and says to run `start`; before, it created the project and then
failed on the default schema and flow. Without a terminal, `setup` now names
every framework it can scaffold and the command to rerun. It no longer asks to
confirm a framework the developer just picked, and its summary no longer calls
a `--force` scaffold a project without existing files.
