---
title: Zitadel NextGen 0.4.0
summary: The API moves under /api/v1, the session cookie becomes one no other site can plant, and zitadel setup ends with a deployed release. This release has breaking changes, so read the upgrade notes.
date: 2026-11-01T21:16Z
pulls: [2359, 2488, 2469]
---

0.4.0 settles where the API lives and hardens the session, ahead of 1.0.0. Install it with `npx @zitadel/cli@latest`. NextGen is still a preview: until 1.0.0, a minor release can include breaking changes, and this one has several. Update a self-hosted server first, then everything that calls it, as Upgrading from 0.3.0 below lists.

## What's new

- **The API under /api/v1.** The server answers there, and the SDKs, the console and the CLI call it there; the old paths keep working until 1.0.0. [More](https://preview.zitadel.com/changelog/api-under-api-v1)
- **A session cookie no other site can plant.** `__Host-zitadel_session`, and security headers on every page the server serves. [More](https://preview.zitadel.com/changelog/session-cookie-other-sites-cannot-plant)
- **Setup ends with a deployed release.** `zitadel setup` deploys `.zitadel/` once it has committed the project. [More](https://preview.zitadel.com/changelog/setup-deploys-the-first-release)
- **Deploy from CI without `-m`.** A release takes its message from the pull request or the commit, and `release get` shows what it pins. [More](https://preview.zitadel.com/changelog/release-messages-from-ci)
- **Skills for your coding agents.** `zitadel skills add` adds the skills of the CLI version you run. [More](https://preview.zitadel.com/changelog/skills-add)
- **Every list, every page.** `@zitadel/api`'s list methods follow the cursor with `items()`, `pages()` and `all()`. [More](https://preview.zitadel.com/changelog/api-client-paging)
- **In the console.** A schema's revisions and who is on each, how every admin holds access, and the policy a release pins. [Schemas](https://preview.zitadel.com/changelog/console-schema-revisions), [access and policies](https://preview.zitadel.com/changelog/console-admin-access-and-pinned-policy)
- **Safer user deletion.** Deleting a user revokes their grants, and never removes a project's last owner. [More](https://preview.zitadel.com/changelog/deleting-a-user)
- **For self-hosting.** The console signs in with the configuration its server ships, and `server.console_origins` names more addresses it is reached at. [More](https://preview.zitadel.com/changelog/console-sign-in-is-a-release)

## Upgrading from 0.3.0

- Upgrade a self-hosted server first, then set every `@zitadel/*` package to `0.4.0`, the CLI and `@zitadel/testing` included: clients from this release call the API under `/api/v1`, and a server and an SDK from different sides of this release keep no session together ([#2359](https://github.com/zitadel/nextgen/pull/2359), [#2488](https://github.com/zitadel/nextgen/pull/2488)).
- **Breaking:** every browser signs in again, because the session cookie is now `__Host-zitadel_session` and `__nextgen_session` is no longer read. preview.zitadel.com has used the new names since 30 October, so update apps that sign in there ([more](https://preview.zitadel.com/changelog/session-cookie-other-sites-cannot-plant)).
- **Breaking:** in a single-page app set up by an earlier `zitadel setup`, run `zitadel doctor --fix`: sign-in fails through the dev proxy it wrote until then. A production proxy you wrote for a single-page app must add the project secret to `POST /api/v1/sessions/exchange` ([#2357](https://github.com/zitadel/nextgen/pull/2357), [#2359](https://github.com/zitadel/nextgen/pull/2359)).
- **Breaking:** a self-hosted console signs in only at `server.public_base` or a loopback address, new console passwords need at least 15 characters, and configuration set on the platform project through the API no longer applies. Set `server.public_base` to the address you use, and list others in `server.console_origins` ([#2469](https://github.com/zitadel/nextgen/pull/2469), [#2462](https://github.com/zitadel/nextgen/pull/2462)).
- Move clients that call the API at its old paths to `/api/v1`: until 1.0.0 the server answers them with a `Deprecation` header ([#2358](https://github.com/zitadel/nextgen/pull/2358)).
- `DELETE /users/{user_id}` answers `409` `proj.last_owner` for the last active member of a project's owning team ([#2398](https://github.com/zitadel/nextgen/pull/2398)).
- A client you generate from the API document now names the session cookie's security scheme `sessionCookie` instead of `nextgenSession` ([#2475](https://github.com/zitadel/nextgen/pull/2475)).
- If sign-in behind a compressing edge failed with "got no response" after a successful exchange, update the SDKs: their proxies no longer forward a `content-encoding` for a body `fetch` has already decoded ([#2503](https://github.com/zitadel/nextgen/pull/2503)).
- A self-hosted server's event webhook and stdout sinks no longer miss an event that commits after a later one, and servers that start together on PostgreSQL no longer deadlock on a migration ([#2551](https://github.com/zitadel/nextgen/pull/2551), [#2499](https://github.com/zitadel/nextgen/pull/2499)).

Every change since 0.3.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.4.0).
