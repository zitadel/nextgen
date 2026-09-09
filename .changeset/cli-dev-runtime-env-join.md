---
"@zitadel/cli": minor
---

`zitadel start` now hands the environment variables your project's resources reference to the local runtime.

At spawn the CLI reads `.env.local`, then `.env`, then your shell, and forwards only the names referenced by files under `.zitadel/`: through the process environment on the binary backend and as bare `--env NAME` on Docker. No value ever reaches the command line, `.zitadel/local/runtime.json`, logs, or `--json` output; only the names are recorded, as `env.injected` and `env.missing`, and `zitadel status` reports them. A missing value prints a warning naming the variable and the runtime still starts; add the value, then `zitadel stop` and `zitadel start`, since a running runtime is not updated in place.
