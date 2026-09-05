---
"@zitadel/server": minor
---

The server can now be told to refuse to start rather than generate a master key. Pass `--disable-master-key-generation`, or set `server.generate_master_key: false` / `NEXTGEN_SERVER_GENERATE_MASTER_KEY=false`; a start that finds no key in `server.master_keys` and no key file in the master key directory then fails with an error naming the directory it searched. Generation stays on by default, so a first local start still needs no configuration. Turn it off wherever the data directory is not durable: without it every instance mints its own key, and a project key wrapped by one instance cannot be unwrapped by the next. The server also warns when `NEXTGEN_SERVER_MASTER_KEYS_*` variables are set, which never reach the configuration because master keys are keyed by key id and environment variables cannot populate map keys.
