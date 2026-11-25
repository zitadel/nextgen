---
title: Deploy a release from the CLI
summary: zitadel deploy replaces plan and apply. It builds .zitadel/ into one release, shows what changes against the live one, and makes it live on your project's primary origins.
date: 2026-10-27T23:26Z
pulls: [1651, 1650, 2269]
---

`zitadel deploy` builds everything in `.zitadel/`, identity provider connections included, into one immutable release, shows its git diff against the live release, and makes it live on the project's primary origins. `zitadel deploy --dry-run` stops before anything goes live.

- `zitadel origin add <pattern> --kind primary|preview`, `origin list` and `origin rm` manage the origins a project serves, with the project secret. A primary origin is an exact URL, and a preview wildcard on a shared host needs a literal label of your own.
- `zitadel release` and `zitadel deployment` create, list, deploy, roll back and revoke releases directly, as do their operations in `@zitadel/api`. A rollback lists the revisions it restores.
- Deploying a changed identity provider connection no longer fails with `500` `internal`, and switching a connection back to an earlier document reuses that revision.

**Breaking:** `plan` and `apply` are removed: use `deploy --dry-run` where you ran `plan`, and `deploy` where you ran `apply`. `releases list` and `releases get` are now `release list` and `release get`, beside `release create` and `release revoke`. A server refusal because of the state it holds, an HTTP 409, now fails every command with `E_CONFLICT` (exit 5) rather than `E_VALIDATION` (exit 3), and a target the project does not hold as an origin fails with `E_VALIDATION` rather than `E_AUTH`.

## Upgrading a project set up with 0.1.0

Its app URL is registered as a preview origin only, so its first `deploy` fails with "The project has no primary origin to deploy to". Run `zitadel doctor --fix` once to make that URL primary, as `zitadel setup` now does; `zitadel doctor` warns about such a project, and `deploy` suggests the fix.

[The deploy guide](https://preview.zitadel.com/docs/guides/deploy), [zitadel origin add](https://preview.zitadel.com/docs/reference/cli/origin/add)
