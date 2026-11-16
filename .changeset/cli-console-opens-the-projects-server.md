---
"@zitadel/cli": minor
---

`zitadel console` now opens the console of the server a project uses when no local server was started there: a project on the hosted cloud gets `/console/`, and one on a self-hosted server gets `/ui/console/`, instead of the "local server is not running" error that pointed to `zitadel start`. `zitadel claim` on a project that already belongs to a team now prints the link to its console, in the text and as `data.console_url` in `--json`.
