---
"@zitadel/cli": minor
"@zitadel/api": minor
---

Every CLI command that deletes, revokes or rolls back something now asks first, and needs `--force` when nobody can be asked. When nobody can be asked and `--force` is missing, the command fails with `E_CONFIRMATION_REQUIRED` (exit 3) and puts the question it would have asked in `details.question`, so a coding agent asks the user before it runs the `--force` retry in `next_commands`. `@zitadel/api`'s operation list marks those operations with a new `destructive` field and a `destructiveOperations` list.

**Breaking:** A destructive command refused for want of `--force` now fails with `E_CONFIRMATION_REQUIRED` instead of `E_VALIDATION`; the exit code stays 3. `zitadel api` now asks before an operation that deletes, revokes or rolls back, and refuses it without `--force` when non-interactive. `doctor --fix` asks before making a preview issuer origin primary; when non-interactive it skips that repair with a warning unless its new `--force` is passed. `setup --dev-port` asks before removing the app's previous origin; without `--force` in a non-interactive run it keeps the old origin and warns.
