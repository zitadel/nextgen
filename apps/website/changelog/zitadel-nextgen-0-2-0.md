---
title: Zitadel NextGen 0.2.0
summary: Deploy and preview releases from the CLI, keep development, staging and production apart in one checkout, and ship your password policy with each release. This release has breaking changes, so read the upgrade notes.
date: 2026-10-27T23:26Z
pulls: [1651, 1652, 1649]
---

0.2.0 takes a project from your repository to production, and to every pull request's preview, with the CLI. Install it with `npx @zitadel/cli@latest`. NextGen is still a preview: until 1.0.0, a minor release can include breaking changes, and this one has several: each is listed under Upgrading from 0.1.0 below.

## What's new

- **Deploy from the CLI.** `zitadel deploy` builds `.zitadel/` into one release, shows what changes, and makes it live on your primary origins; `zitadel release` and `zitadel deployment` roll back and revoke. [More](https://preview.zitadel.com/changelog/deploy-from-the-cli)
- **A preview for every pull request.** `zitadel preview` makes a branch's release live on its preview URLs, and a variable can hold a value of its own for previews. [More](https://preview.zitadel.com/changelog/preview-from-the-cli)
- **One checkout, several environments.** The CLI resolves the server, project and credential per environment from your `.env` files. [More](https://preview.zitadel.com/changelog/cli-environments)
- **Back from a release.** `zitadel pull` rebuilds `.zitadel/` from what a release pins. [More](https://preview.zitadel.com/changelog/pull-a-release)
- **Password policies as code.** `zitadel setup` writes a 15-character minimum, and `zitadel deploy` ships `.zitadel/policies/` with each release. [More](https://preview.zitadel.com/changelog/policies-as-files)
- **Sign-ins that keep their release.** A sign-in uses what its release pins and the variables its deployment froze, so a deploy does not change a sign-in under way. [More](https://preview.zitadel.com/changelog/sign-ins-use-what-their-release-pins)
- **A console to deploy from.** Deployments and releases, a reworked navigation, and a Users table that fits any schema. [Deployments](https://preview.zitadel.com/changelog/console-deployments), [navigation](https://preview.zitadel.com/changelog/console-navigation), [users](https://preview.zitadel.com/changelog/console-users-table)
- **A login that explains itself.** It says why it switched to sign-up, and shows the account with an avatar. [Switch](https://preview.zitadel.com/changelog/login-explains-the-switch), [avatar](https://preview.zitadel.com/changelog/login-account-avatar)
- **For self-hosting.** `/readyz` waits for the database, the logs have a line per request, and platform operators administer every project. [Readiness](https://preview.zitadel.com/changelog/readiness-checks-the-database), [logs](https://preview.zitadel.com/changelog/server-logs), [operators](https://preview.zitadel.com/changelog/platform-operators)

## Upgrading from 0.1.0

- Set every `@zitadel/*` package to `0.2.0`, and update the CLI, `@zitadel/testing` and a self-hosted server together: an earlier CLI or test kit waits for `/healthz`, which this release removes ([#2308](https://github.com/zitadel/nextgen/pull/2308)).
- **Security:** update apps that use a server SDK: signing out through its proxy left the session in the shared cookie valid until it expired ([#2375](https://github.com/zitadel/nextgen/pull/2375)).
- Run `zitadel doctor --fix` once in a project set up with 0.1.0, so its app URL becomes a primary origin and `zitadel deploy` has somewhere to deploy ([#1651](https://github.com/zitadel/nextgen/pull/1651)).
- **Breaking:** `plan` and `apply` are now `deploy --dry-run` and `deploy`, `releases` is now `release`, and a 409 from the server fails a command with `E_CONFLICT` (exit 5) ([#1651](https://github.com/zitadel/nextgen/pull/1651)).
- **Breaking:** the CLI no longer reads the server from `ZITADEL_API_BASE` or the `server` field of `zitadel.json`: set `ZITADEL_URL` in an env file, or pass `--server`. `-e` now means `--env` ([#1649](https://github.com/zitadel/nextgen/pull/1649)).
- **Breaking:** `variables` is now `variable`, without `--project-level`; a variable holds a primary and a preview value ([more](https://preview.zitadel.com/changelog/preview-from-the-cli)).
- **Breaking:** a scripted `zitadel setup` publishes a 15-character password minimum; pass `--password-min-length` for another ([#2279](https://github.com/zitadel/nextgen/pull/2279)).
- **Breaking:** `zitadel start --json` no longer has `data.console` or `data.urls.login`, and the server no longer serves `/ui/login/` or reads `server.login_enabled` and `server.login_path` ([#2323](https://github.com/zitadel/nextgen/pull/2323), [#2307](https://github.com/zitadel/nextgen/pull/2307)).
- **Breaking:** SvelteKit apps need SvelteKit 3 ([#2383](https://github.com/zitadel/nextgen/pull/2383)).
- In a Next.js app, replace the `matcher` in `proxy.ts` or `middleware.ts` with `["/((?!_next/static|_next/image|favicon.ico).*)"]`, so every route in `protectedRoutes` requires a sign-in ([#2372](https://github.com/zitadel/nextgen/pull/2372)).
- A page that shows its own heading in place of the login's should follow `step.purpose` from the `zitadel-flow-step` event ([#2373](https://github.com/zitadel/nextgen/pull/2373)).
- To show users by name rather than by email, add `"x-display": ["givenName", "familyName"]` to the user schema and run `zitadel deploy` ([#2368](https://github.com/zitadel/nextgen/pull/2368)).

Every change since 0.1.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.2.0).
