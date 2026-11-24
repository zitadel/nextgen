---
title: Zitadel NextGen 0.8.0
summary: Invite people into a project with a link, script every zitadel command with one JSON document and --fields, read who is signed in with useSession() in React, and run the local server on Windows. This release has breaking changes, so read the upgrade notes.
date: 2026-11-24T02:09Z
pulls: [2929, 3245, 3264, 2898]
---

0.8.0 adds invitations, makes the CLI scriptable by agents, and runs the local server on Windows. Install it with `npx @zitadel/cli@latest`, or run `zitadel upgrade` in a project. NextGen is still a preview: until 1.0.0, a minor release can include breaking changes, and this one has several in the CLI's output.

## What's new

- **Invitations.** `zitadel invitation create` prints a link that grants a project role, and a signed-in user can accept or decline it. [More](https://preview.zitadel.com/changelog/invite-people-with-a-link)
- **A scriptable CLI.** Every command takes its whole invocation as JSON with `--input`, every list and get takes `--fields`, and JSON comes only with `--json`. [More](https://preview.zitadel.com/changelog/cli-scriptable-json-input-and-fields)
- **`useSession()` in React.** Your own components can read who is signed in, from one read the page shares. [More](https://preview.zitadel.com/changelog/react-use-session)
- **Project members.** `GET /projects/{project_id}/members` lists everyone with a role on a project and how they hold it. [More](https://preview.zitadel.com/changelog/list-project-members)
- **Windows.** The local server starts on Windows, and `setup` and `doctor` work there. [More](https://preview.zitadel.com/changelog/cli-and-local-server-on-windows)
- **Fixes.** The API returns timestamps in UTC whatever zone the server runs in ([#3213](https://github.com/zitadel/nextgen/pull/3213)), `zitadel doctor --fix` restores a missing `.zitadel/secret` ([#3210](https://github.com/zitadel/nextgen/pull/3210)), `deploy` no longer marks a release dirty because of an uncommitted file outside `.zitadel/` ([#3205](https://github.com/zitadel/nextgen/pull/3205)), a `401` from `zitadel api` names the server and secret it used ([#3206](https://github.com/zitadel/nextgen/pull/3206)), `deploy` warns about a dead per-theme logo URL ([#3203](https://github.com/zitadel/nextgen/pull/3203)), and `zitadel setup` creates Next.js apps on 16.4.6, with its security fixes ([#3033](https://github.com/zitadel/nextgen/pull/3033)).

## On the way: OAuth for your apps

A release can now carry OAuth settings, and a server started with `oauth.enabled` serves each issuer's metadata and accepts authorization code requests ([#2885](https://github.com/zitadel/nextgen/pull/2885), [#3075](https://github.com/zitadel/nextgen/pull/3075)). The console shows an application and its OAuth clients at `/applications/{application_id}` ([#3214](https://github.com/zitadel/nextgen/pull/3214)), and `@zitadel/config` exports a `webApplication()` preset ([#3076](https://github.com/zitadel/nextgen/pull/3076)). `zitadel deploy` cannot send OAuth settings yet, and deploying with it turns a project's OAuth off.

## Upgrading from 0.7.0

- Upgrade a self-hosted server, then run `zitadel upgrade` to set every `@zitadel/*` package to `0.8.0`.
- **Breaking:** pass `--json` wherever a script parses the CLI's JSON: off a terminal, `get` commands and created or updated resources now print plain text ([more](https://preview.zitadel.com/changelog/cli-scriptable-json-input-and-fields)).
- **Breaking:** `zitadel api --input <path>` is now `zitadel api --file <path>`, and an update with `:=null` needs `--force` when nothing can ask ([more](https://preview.zitadel.com/changelog/cli-scriptable-json-input-and-fields)).
- **Breaking:** `--fields` now cuts `--json` too, `version --json` and `commands --json` print their result as `data`, and a refused command line no longer carries `details.original` ([more](https://preview.zitadel.com/changelog/cli-scriptable-json-input-and-fields)).
- **Breaking:** invitations report `responded_by` and `responded_at` in place of `accepted_by` and `accepted_at` ([more](https://preview.zitadel.com/changelog/invite-people-with-a-link)).

Every change since 0.7.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.8.0).
