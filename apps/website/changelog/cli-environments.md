---
title: One checkout for development, staging and production
summary: CLI commands resolve the server, project and credential per environment, from flags, the process environment and your .env files, and zitadel env shows what resolved and from where.
date: 2026-10-27T23:26Z
pulls: [1649]
---

Commands that talk to a project now resolve its server, project and credential per environment, so one checkout can serve development, staging and production. `zitadel env` shows what resolved and from where, `env list` lists the environments, and `env add` binds one.

- Values come from flags, the process environment, `.env.<name>.local`, `.env.local`, `.env.<name>` and `.env`. Only `development` reads `.env.local`.
- Commands the CLI suggests running next keep the run's `--env`, `--env-file` or `--server`, so following one targets the same project instead of the default one.

**Breaking:** the server no longer comes from `ZITADEL_API_BASE`, the `server` field of `zitadel.json`, or a cloud default. Set `ZITADEL_URL` in an env file, or pass `--server`; only `setup` still defaults to Zitadel Cloud. `zitadel.json` no longer gets an `environments` block, `environments list` and `environments get` are gone, and `-e` now means `--env`.

[zitadel env](https://preview.zitadel.com/docs/reference/cli/env)
