---
title: Zitadel NextGen 0.3.0
summary: Test your password policy before you deploy it, review a deploy's diff from a script, and find the users left on an older schema revision. A self-hosted server reports metrics for its API, database and sign-ins.
date: 2026-10-29T07:54Z
pulls: [2353, 2288, 2321]
---

0.3.0 lets you check your configuration before it goes live, from the terminal or a script. Install it with `npx @zitadel/cli@latest`. No change in it is breaking, but read Upgrading from 0.2.0 below if you script `zitadel setup` or run your own server.

## What's new

- **Test a policy before you deploy it.** `zitadel policies test` runs the cases in `.zitadel/policies/<operation>.test.json` against your policy, or the one a release pins. [More](https://preview.zitadel.com/changelog/test-a-password-policy)
- **Review a deploy from a script.** `zitadel deploy --dry-run --json` reports the diff, and `zitadel setup` commits the project, so that diff is real. [More](https://preview.zitadel.com/changelog/review-a-deploy-from-a-script)
- **The password minimum up front.** `<zitadel-login>` shows it while someone chooses a password. [More](https://preview.zitadel.com/changelog/login-shows-the-password-minimum)
- **Find the users left to migrate.** `POST /users/query` and `zitadel users list --filter` list the users still on an older schema revision. [More](https://preview.zitadel.com/changelog/find-users-on-an-older-schema)
- **A project page in the console.** Manage origins, see variables and secrets, and check the password policy. [More](https://preview.zitadel.com/changelog/console-project-page)
- **For self-hosting.** Metrics for the API, the database, sign-ins and audit writes. A server that runs only while it serves a request, such as a Vercel function, can leave the purge of expired audit events to a scheduler that calls `/cron/events-retention` ([#2397](https://github.com/zitadel/nextgen/pull/2397)). [Metrics](https://preview.zitadel.com/changelog/server-metrics)

## Upgrading from 0.2.0

- Set every `@zitadel/*` package to `0.3.0`.
- **Security:** update a self-hosted server: a JWK set that contains a crafted RSA key could hang it ([#2419](https://github.com/zitadel/nextgen/pull/2419)).
- `zitadel setup` now commits the project it scaffolds, and refuses a repository with uncommitted work, untracked files included. Pass `--no-git` to skip the commit ([#2321](https://github.com/zitadel/nextgen/pull/2321)).
- A relative `--env-file` is now read from the current directory, where Node itself reads it, instead of from `--cwd` ([#2416](https://github.com/zitadel/nextgen/pull/2416)).
- A self-hosted server that fails to flush its traces, metrics or logs on shutdown now exits with code 1, also on a planned stop, for example when its OpenTelemetry collector is unreachable ([#1468](https://github.com/zitadel/nextgen/pull/1468)).
- Deleting a user now revokes every grant they held, on any project ([#2438](https://github.com/zitadel/nextgen/pull/2438)).

Every change since 0.2.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.3.0).
