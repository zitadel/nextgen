---
title: The CLI asks before it deletes, revokes or rolls back
summary: Every zitadel command that deletes, revokes or rolls back something now asks first, and needs --force when nobody can be asked, so a coding agent puts the question to you before it retries.
date: 2026-11-06T23:31Z
pulls: [2568]
---

Every `zitadel` command that deletes, revokes or rolls back something now asks you first. When nobody can be asked, as in a script or a coding agent's run, it needs `--force`.

- Without `--force` and with nobody to ask, the command fails with `E_CONFIRMATION_REQUIRED` (exit 3) and puts the question it would have asked in `details.question`. An agent reads it, asks you, and only then runs the `--force` retry in `next_commands`.
- `zitadel api` asks before an operation that deletes, revokes or rolls back, and refuses it without `--force` when non-interactive.
- `zitadel doctor --fix` asks before it makes a preview issuer origin primary. When non-interactive, it skips that repair with a warning unless you pass its new `--force`.
- `zitadel setup --dev-port` asks before it removes the app's previous origin. Without `--force` in a non-interactive run, it keeps the old origin and warns.
- `@zitadel/api`'s operation list marks these operations with a `destructive` field and a `destructiveOperations` list.

**Breaking:** a destructive command refused for want of `--force` now fails with `E_CONFIRMATION_REQUIRED` instead of `E_VALIDATION`; the exit code stays 3. A script that branches on the code must check for the new one, and a non-interactive `zitadel api` call that deletes, revokes or rolls back needs `--force`.

[The CLI for agents](https://preview.zitadel.com/docs/get-started/agents)
