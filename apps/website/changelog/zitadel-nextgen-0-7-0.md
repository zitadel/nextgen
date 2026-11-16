---
title: Zitadel NextGen 0.7.0
summary: Sign-ups solve a proof of work, the console follows every sign-in and starts at the platform, zitadel tests add writes your app's end-to-end tests, and the API and CLI name everything one way. This release has breaking changes, so read the upgrade notes.
date: 2026-11-16T17:01Z
pulls: [2626, 3007, 3107, 2379]
---

0.7.0 protects sign-up, shows each sign-in step by step, and names everything in the API and the CLI one way. Install it with `npx @zitadel/cli@latest`, or run `zitadel upgrade` in a project. NextGen is still a preview: until 1.0.0, a minor release can include breaking changes, and this one has several. Update a self-hosted server first, then everything that calls it.

## What's new

- **Sign-ups solve a proof of work.** `<zitadel-login>` solves it for you, and `zitadel setup` writes the sign-up policy. [More](https://preview.zitadel.com/changelog/sign-ups-solve-a-proof-of-work)
- **Sign-ins in the console.** Events, formerly Logs, shows each sign-in's steps and timing, and lists what happened to one account. [More](https://preview.zitadel.com/changelog/console-sign-ins)
- **The platform at the console's root.** Your projects sit beneath it, the top bar names where you are, and ⌘K ranks matches across projects. [More](https://preview.zitadel.com/changelog/console-platform-and-search)
- **Test your app.** `zitadel tests add` writes Playwright tests of a Next.js app's sign-in, and `@zitadel/testing/vitest` runs backend tests against a real server. [More](https://preview.zitadel.com/changelog/test-your-app)
- **One way to read the CLI.** Every command and error reads the same, resource commands are singular, and the help groups them by task. [More](https://preview.zitadel.com/changelog/cli-reads-the-same-everywhere)
- **One way to name the API.** 34 operations are renamed, and the login flow API moves to `/flows`. [More](https://preview.zitadel.com/changelog/api-names-follow-one-scheme)
- **Seed once per deployment.** A self-hosted server seeds with its own `seed` command and limits concurrent password hashing. [More](https://preview.zitadel.com/changelog/seed-a-server-once-per-deployment)
- **Security fix.** `zitadel api` calls your project's own server; it used to send a local or self-hosted project's secret to the cloud. [More](https://preview.zitadel.com/changelog/cli-calls-your-projects-server)
- **Fixes.** `zitadel deployment rollback` and `deploy` no longer take a preview deployment for a primary one ([#3084](https://github.com/zitadel/nextgen/pull/3084)), `zitadel release revoke` names the origins that still serve a release ([#3037](https://github.com/zitadel/nextgen/pull/3037)), the CLI uses `pnpm`, `yarn` or `bun` for an app inside a workspace ([#3062](https://github.com/zitadel/nextgen/pull/3062)), and `zitadel stop --all` stops only real servers ([#3171](https://github.com/zitadel/nextgen/pull/3171)).

## Upgrading from 0.6.0

- Upgrade a self-hosted server first, then run `zitadel upgrade` to set every `@zitadel/*` package to `0.7.0`: the 0.7.0 clients call `/flows`, which a 0.6.0 server answers with `404`.
- **Breaking:** a password or passkey sign-up without a proof of work is refused. Upgrade `@zitadel/components`, or the SDK that pins it, together with the server ([more](https://preview.zitadel.com/changelog/sign-ups-solve-a-proof-of-work)).
- **Breaking:** delete the `"status"` line from each file in `.zitadel/flows/` before your next `zitadel deploy`, and move a draft flow that should stay off out of that folder before you upgrade ([more](https://preview.zitadel.com/changelog/releases-decide-which-flows-are-live)).
- **Breaking:** rename your API calls, read `GET /events` from `events` instead of `data`, and page `GET /branding` ([more](https://preview.zitadel.com/changelog/api-names-follow-one-scheme)).
- **Breaking:** a script that reads the CLI's text needs `Error: … (E_…)` instead of `Error E_…:`, and `--json` names commands in the singular, as `user:list` ([more](https://preview.zitadel.com/changelog/cli-reads-the-same-everywhere)).
- **Breaking:** a refused `zitadel release revoke --json` lists the serving origins in `details.origins`, where they were in `details.body.details.origins` ([#3037](https://github.com/zitadel/nextgen/pull/3037)).
- In a React, Vue, Solid, Svelte or Qwik app set up before, run `zitadel doctor --fix` so its Vite dev proxy reads `ZITADEL_URL` ([more](https://preview.zitadel.com/changelog/test-your-app)).

Every change since 0.6.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.7.0).
