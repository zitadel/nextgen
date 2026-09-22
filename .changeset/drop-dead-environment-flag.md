---
"@zitadel/cli": minor
---

**Breaking:** remove `--environment` (`-e`) from `plan`, `apply` and the resource commands (`users`, `teams`, `sessions`, `events`, `grants`, `idps`, `projects`, `schemas`, `environments`, `releases`, `flow-definitions`, `branding`). It only accepted `development`, `preview` or `production`, which are not the platform's environment names, and it never reached the platform: its one effect was to read a server URL from `environments.<name>.server` in `zitadel.json`, which nothing writes. Passing it now fails as an unknown flag; drop it from scripts. `--server`, `ZITADEL_API_BASE` and the top-level `server` in `zitadel.json` still choose the server. `--environment` now means one thing: a real environment on the platform, as the `variables` commands use it.
