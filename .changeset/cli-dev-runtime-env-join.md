---
"@zitadel/cli": minor
---

The project's env files now configure the local server.

`zitadel start` reads `.env.local`, then `.env`, and hands every `NEXTGEN_*` variable to the server it launches: through the process environment on the binary backend and as bare `--env NAME` on Docker. No value ever reaches the command line, `.zitadel/local/runtime.json`, logs, or `--json` output; only the names are recorded, as `env.injected`, and `zitadel status` reports them. The address, data directory and public base the CLI sets itself always win. A running runtime is not updated in place, so after changing a value run `zitadel stop` and `zitadel start`.

`setup` now writes a comment at the top of the scaffolded `.env.example` and `.env.local` saying so.
