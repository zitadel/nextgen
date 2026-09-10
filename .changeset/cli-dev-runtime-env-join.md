---
"@zitadel/cli": minor
---

`zitadel start` hands `ZITADEL_*` variables from your env files to the local runtime.

At spawn the CLI reads `.env.local`, then `.env`, and forwards every `ZITADEL_*` variable: through the process environment on the binary backend and as bare `--env NAME` on Docker. No value ever reaches the command line, `.zitadel/local/runtime.json`, logs, or `--json` output; only the names are recorded, as `env.injected`, and `zitadel status` reports them. A running runtime is not updated in place, so after changing a value run `zitadel stop` and `zitadel start`.
