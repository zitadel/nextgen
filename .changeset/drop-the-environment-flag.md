---
"@zitadel/cli": minor
---

**Breaking:** remove `--environment` (`-e`) from `plan`, `apply` and the resource commands (`users`, `teams`, `sessions`, `events`, `grants`, `idps`, `projects`, `schemas`, `environments`, `releases`, `flow-definitions`, `branding`). It accepted only `development`, `preview` or `production` — none of them a name the platform uses — and never reached the platform: its one effect was to read a server URL from `environments.<name>.server` in `zitadel.json`, a key nothing writes. Passing it now fails as an unknown flag; drop it from scripts. `--server`, `ZITADEL_API_BASE` and the top-level `server` in `zitadel.json` still choose the server, and `environments list` / `environments get` still read the platform's environments.

The CLI therefore has no per-environment flag at all until the platform's environments settle, which is also why the new `variables` commands address the project level only. Their own `--environment` / `--env` never shipped.
