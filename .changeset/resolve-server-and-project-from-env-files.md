---
"@zitadel/cli": minor
---

Commands that talk to a project now resolve its server, project and credential per environment, so one checkout can serve development, staging and production; `zitadel env` shows what resolved and from where, `env list` lists the environments and `env add` binds one ([docs](https://preview.zitadel.com/docs/reference/cli/env)). Values come from flags, the process environment, `.env.<name>.local`, `.env.local`, `.env.<name>` and `.env`; only `development` reads `.env.local`.

**Breaking:** the server no longer comes from `ZITADEL_API_BASE`, the `server` field of `zitadel.json`, or a cloud default. Set `ZITADEL_URL` in an env file, or pass `--server`; only `setup` still defaults to Zitadel Cloud. `zitadel.json` no longer gets an `environments` block, `environments list` and `environments get` are gone, and `-e` now means `--env`.
