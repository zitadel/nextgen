---
"@zitadel/cli": minor
---

**Breaking:** remove `--environment` (`-e`, `--env`) from every command. On `plan`, `apply` and the resource commands it accepted only `development`, `preview` or `production` — none of them a name the platform uses — and never reached the platform at all: its one effect was to read a server URL from `environments.<name>.server` in `zitadel.json`, a key nothing writes. On the `variables` commands it named a real environment, but the platform's environments are not settled yet, so a value written against a name that later changes is a value nothing will read.

The `variables` commands therefore address the project level, and `--project-level` is now required rather than one of two choices: a run that names no owner fails, so no command written today changes meaning when `--environment` returns. Their `--json` envelopes no longer carry the `environment` key, and per-environment variables are unreachable from the CLI until then; `--server`, `ZITADEL_API_BASE` and the top-level `server` in `zitadel.json` still choose the server.
