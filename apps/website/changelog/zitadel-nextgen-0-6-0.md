---
title: Zitadel NextGen 0.6.0
summary: The console gets Logs, a project Overview and a search that finds users and configuration, zitadel deploy reports every configuration problem at once, and two security fixes. This release has breaking changes, so read the upgrade notes.
date: 2026-11-11T17:33Z
pulls: [2556, 2687, 2889, 2940]
---

0.6.0 brings a project's activity into the console and holds every `.zitadel/` file to one set of rules. Install it with `npx @zitadel/cli@latest`, or run `zitadel upgrade` in a project. NextGen is still a preview: until 1.0.0, a minor release can include breaking changes, and this one has several. Update a self-hosted server first, then everything that calls it.

## What's new

- **Logs in the console.** A project's audit events and API requests, with filters, a search, a live mode and an export. [More](https://preview.zitadel.com/changelog/console-logs)
- **A project Overview.** A project opens on what its origins serve and its latest events, and the sidebar lists its screens. [More](https://preview.zitadel.com/changelog/console-project-overview)
- **Find users and configuration.** ⌘K finds users, schemas, flows and identity providers, and the Users list searches by identifier and filters by status and creation date. [More](https://preview.zitadel.com/changelog/find-users-and-configuration)
- **One set of rules for `.zitadel/`.** `zitadel deploy` reports every problem in one error, in plain words, and asks before it locks users out. [More](https://preview.zitadel.com/changelog/deploy-reports-every-config-issue)
- **Attributes match their format.** A value like `not-an-email` for an email property is refused. [More](https://preview.zitadel.com/changelog/user-attributes-match-their-format)
- **Rollbacks serve their own origins.** A rollback deploys to the origins of the deployment it restores, and says which. [More](https://preview.zitadel.com/changelog/rollback-serves-its-origins)
- **SSO on deployed apps.** `zitadel auth-method sso enable` prints the callback URI for every deployed origin, and describes what the connection maps. [More](https://preview.zitadel.com/changelog/sso-enable-prints-every-callback-uri)
- **Security fixes.** A project secret can no longer create a session in another project, and deactivating a user ends their direct grants. [More](https://preview.zitadel.com/changelog/sessions-stay-in-their-project)
- **Fixes.** The login's identifier step stays fast in projects with many users ([#2395](https://github.com/zitadel/nextgen/pull/2395)), `server.idle_timeout` stops a proxy's `POST` ending as a 502 ([#2952](https://github.com/zitadel/nextgen/pull/2952)), and a schema field named `name` no longer breaks registration in `<zitadel-login>` ([#2899](https://github.com/zitadel/nextgen/pull/2899)).

## Upgrading from 0.5.0

- Upgrade a self-hosted server first, then run `zitadel upgrade` to set every `@zitadel/*` package to `0.6.0`.
- **Breaking:** `deploy`, `preview` and `release create` report an invalid configuration as one `E_VALIDATION` with `details.issues`, in place of the separate flow, SSO and missing-variable errors, and a non-interactive `deploy` that would lock users out needs `--force`. An older CLI cannot read a `.zitadel/state.json` that 0.6.0 creates ([more](https://preview.zitadel.com/changelog/deploy-reports-every-config-issue)).
- **Breaking:** a stored user attribute that fails its `format` blocks a patch until the same request corrects it, and such an identifier no longer signs in ([more](https://preview.zitadel.com/changelog/user-attributes-match-their-format)).
- **Breaking:** a rollback deploys to the origins of the deployment it goes back to. Run `zitadel deploy` to serve an origin added since ([more](https://preview.zitadel.com/changelog/rollback-serves-its-origins)).
- **Breaking:** a page of `GET /events` can hold fewer events than `limit`, or none: follow `next_page_token` until a response has none ([more](https://preview.zitadel.com/changelog/console-logs)).
- On Postgres, the migration rebuilds the users and user attributes tables in one transaction, which blocks reads and writes of users while it runs ([#2395](https://github.com/zitadel/nextgen/pull/2395)), and builds new indexes on `events` without blocking writes ([#2940](https://github.com/zitadel/nextgen/pull/2940), [#2965](https://github.com/zitadel/nextgen/pull/2965)). Both take longer the larger the tables.
- `createSanitiser()` in `@zitadel/components` no longer strips `id` or `name` values that match `document` or form properties, so do not insert its output into the main document ([#2899](https://github.com/zitadel/nextgen/pull/2899)).

Every change since 0.5.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.6.0).
