---
title: Zitadel NextGen 0.9.0
summary: Invite colleagues to a project from the console's new Members page, which replaces Add admin, and a script reading the CLI's plain text from a pipe gets only the command's result.
date: 2026-11-24T09:30Z
pulls: [2978, 3066, 3252]
---

0.9.0 brings invitations to the console and keeps the CLI's progress lines out of a script's way. Install it with `npx @zitadel/cli@latest`, or run `zitadel upgrade` in a project. The console's changes have been live on preview.zitadel.com since they merged; a self-hosted server gets them with this release.

## What's new

- **Invitations in the console.** Project Settings → Members invites a colleague with a link, lists the invitations you sent, and opens a page where whoever has the link joins the project or declines. [More](https://preview.zitadel.com/changelog/console-invitations)
- **Output a script can read.** When stdout is not a terminal, the CLI writes only the command's result there. Lines meant for a person, such as `setup`'s `Wrote …` lines or the wait for the browser step in `claim`, appear only on a terminal, and `--debug` detail goes to stderr. `claim` still prints its link, which a script has to open. `server console` and `env add` now list their links and the file they wrote in their result ([#3252](https://github.com/zitadel/nextgen/pull/3252)).

## Upgrading from 0.8.0

- Upgrade a self-hosted server, then run `zitadel upgrade` to set every `@zitadel/*` package to `0.9.0`.
- The console's Members page no longer has Add admin. Invite a colleague with a link, or grant a role to a user or team you already know with `zitadel grant create` ([more](https://preview.zitadel.com/changelog/console-invitations)).
- A script that read the CLI's progress lines from a pipe no longer gets them. Read the command's result, or pass `--json` ([#3252](https://github.com/zitadel/nextgen/pull/3252)).

Every change since 0.8.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.9.0).
