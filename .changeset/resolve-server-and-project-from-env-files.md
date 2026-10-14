---
"@zitadel/cli": minor
---

Every command that talks to a project now reads the server, the project and its credential from the environment it runs in, so one checkout can work against a development, a staging and a production project. Each value comes from the first place that has it: `--server`, `--env-file <path>`, the process environment, `.env.<name>.local`, `.env.local`, `.env.<name>`, `.env`, then `.zitadel/secret`. `.env.local` and `.zitadel/secret` hold the project setup created, so only the default `development` environment reads them: another environment, or a run with `--env-file`, never borrows the development project's id or credential. `<name>` is `--env`, then `ZITADEL_ENV`, then the hosting platform's own signal (`VERCEL_ENV`, or `CONTEXT` inside a Netlify build), and `development` when nothing says otherwise. A missing value fails with an error that names the variable, the environment and every file it looked in.

Three new commands work with environments. `zitadel env` shows which server and project resolved and where each value came from, without printing secrets in full. `zitadel env list` lists the environments bound in the directory. `zitadel env add <name>` creates a project, or binds an existing one with `--project`, writes `.env.<name>.local` readable by you alone, and prints the variables your hosting platform and pipeline need for it.

`zitadel setup` now also writes `.env.development.local`, the file the CLI reads, and keeps writing `.env.local` for your app.

**Breaking:** the server no longer comes from `ZITADEL_API_BASE`, the `server` field of `zitadel.json`, or a cloud default. Set `ZITADEL_URL` in an env file, or pass `--server`; only `setup` still defaults to Zitadel Cloud. `zitadel.json` no longer gets an `environments` block, `environments list` and `environments get` are gone, and `-e` now means `--env`.
