---
title: Zitadel NextGen 0.5.0
summary: A sign-in runs only what is deployed, the CLI asks before it deletes, revokes or rolls back, and zitadel deploy warns before it locks users out. This release has breaking changes, so read the upgrade notes.
date: 2026-11-06T23:31Z
pulls: [2553, 2568, 2533]
---

0.5.0 makes a deploy the one way a change reaches your users, and makes the CLI safer to hand to a coding agent. Install it with `npx @zitadel/cli@latest`. NextGen is still a preview: until 1.0.0, a minor release can include breaking changes, and this one has several. Update a self-hosted server first, then everything that calls it, as Upgrading from 0.4.0 below lists.

## What's new

- **A sign-in runs only what is deployed.** What you publish applies once a release that pins it is deployed, and an origin with nothing deployed is refused. [More](https://preview.zitadel.com/changelog/sign-ins-serve-only-what-is-deployed)
- **The CLI asks first.** Every command that deletes, revokes or rolls back asks, and needs `--force` when nobody can be asked. [More](https://preview.zitadel.com/changelog/destructive-commands-ask-first)
- **Deploy warns before it locks users out.** It counts the users a config would leave unable to sign in, and says why the server rejected a release. [More](https://preview.zitadel.com/changelog/deploy-warns-before-locking-users-out)
- **`zitadel upgrade`.** Move a project's `@zitadel/*` packages to the latest release, with its breaking changes shown on the way, and a `zitadel doctor` grouped by category. [More](https://preview.zitadel.com/changelog/zitadel-upgrade)
- **Sign-in, your way.** A flow chooses whether the login switches between sign-in and sign-up, and `zitadel setup` and `zitadel auth-method` say what sign-in will do. [The switch](https://preview.zitadel.com/changelog/flows-choose-the-sign-in-sign-up-switch), [setup](https://preview.zitadel.com/changelog/setup-reports-sign-in), [auth-method](https://preview.zitadel.com/changelog/auth-method-says-what-to-change)
- **Users in the console.** Move a user to another schema revision, check it first with `dry_run`, and set every property of a schema in the forms. [Revisions](https://preview.zitadel.com/changelog/move-users-between-revisions), [forms](https://preview.zitadel.com/changelog/console-user-forms-whole-schema)
- **A steadier login.** `<zitadel-login>` checks fields before it submits and forgets a password between steps, and Nuxt apps installed with npm load the SDK again. [Login](https://preview.zitadel.com/changelog/login-checks-fields-and-forgets-passwords), [Nuxt](https://preview.zitadel.com/changelog/nuxt-sdk-with-npm)
- **For self-hosting.** The server logs every error it answers, and serves the OpenAPI document it was built from. [Logs](https://preview.zitadel.com/changelog/server-logs-every-error), [OpenAPI](https://preview.zitadel.com/changelog/openapi-document-per-deployment)
- **A security fix.** A project secret can no longer read a granted platform user's profile. [More](https://preview.zitadel.com/changelog/grants-keep-platform-profiles-private)

## Upgrading from 0.4.0

- Upgrade a self-hosted server first, then set every `@zitadel/*` package to `0.5.0`, the CLI and `@zitadel/testing` included. From 0.5.0 on, `zitadel upgrade` does this for you.
- **Breaking:** publishing a flow, schema, identity provider, branding or policy no longer changes sign-in or `setUserPassword` until a release that pins it is deployed, and an origin with nothing deployed answers `rel.not_deployed`. Run `zitadel deploy` after you add an origin, add a loopback origin you sign in from as a primary origin and deploy to it, and give the test kit exact URLs in `appOrigins` ([more](https://preview.zitadel.com/changelog/sign-ins-serve-only-what-is-deployed)).
- **Breaking:** a destructive command refused for want of `--force` fails with `E_CONFIRMATION_REQUIRED` instead of `E_VALIDATION`, still exit 3, and a non-interactive `zitadel api` call that deletes, revokes or rolls back needs `--force` ([#2568](https://github.com/zitadel/nextgen/pull/2568)).
- **Breaking:** a flow definition read back through the API leaves out `target` on a transition that only names a `purpose`. Upgrade `@zitadel/api`, or regenerate your client from the new spec, before you deploy a flow that uses the short form, and leave out a `target` you set to `""` ([#2533](https://github.com/zitadel/nextgen/pull/2533)).
- **Breaking:** `targets` on `POST /deployments` is `"primary"` or a list of preview URLs. `["primary"]`, which earlier CLIs and test kits send, still deploys to every primary origin until 1.0.0, with a `Deprecation` header. A `--dry-run --json` from `zitadel deploy` and `zitadel deployment create` prints `data.targets` as `"primary"` ([#2555](https://github.com/zitadel/nextgen/pull/2555)).
- **Breaking:** `expand=principal` on `GET /grants/{id}` and `POST /grants/query` answers `403` `user.permission_denied` unless the caller can read the platform project, and `POST /grants` on an unclaimed project answers `403` `grant.project_unclaimed` ([#2679](https://github.com/zitadel/nextgen/pull/2679)).
- **Breaking:** `zitadel users update --dry-run` calls the server, so it needs a server and a credential, and a failure inside an array item is named by the item, such as `attributes.phones.0.fax`: match those names by prefix ([#2821](https://github.com/zitadel/nextgen/pull/2821)).
- `@zitadel/api/runtime/paging` exports one class, `Paging`, in place of `pages()`, `nextToken()` and `itemsOf()`: use `new Paging({ items, next }).walk(fetch)`, `paging.next(page)` and `Paging.byField(field).items(page)` ([#2613](https://github.com/zitadel/nextgen/pull/2613)).
- A custom login template must render the password field's error (`f.name | fieldError: errors`) to show a wrong password, which now shows on that field instead of in the form-level alert ([#2681](https://github.com/zitadel/nextgen/pull/2681)).
- Update to take the security fixes in dependencies: `@zitadel/cli` requires `undici` 7.30.1 or later, and `@zitadel/cli`, `@zitadel/api` and `@zitadel/config` require `zod` 4.6.6 or later ([#2693](https://github.com/zitadel/nextgen/pull/2693)).

Every change since 0.4.0 is in the [release notes on GitHub](https://github.com/zitadel/nextgen/releases/tag/v0.5.0).
