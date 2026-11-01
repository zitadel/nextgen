---
"@zitadel/cli": minor
"@zitadel/api": minor
---

Every CLI command that deletes, revokes or rolls back something now asks first, and needs `--force` when nobody can be asked. `@zitadel/api`'s operation list marks those operations with a new `destructive` field and a `destructiveOperations` list.

**Breaking:** `zitadel api` now asks before an operation that deletes, revokes or rolls back, including a merge-patch body with a `null` (`updateVariables`, `PatchUserByID`, `patchMyUser`, `patchProject`), and refuses it without `--force` when non-interactive. `doctor --fix` asks before making a preview issuer origin primary; when non-interactive it skips that repair with a warning unless its new `--force` is passed. `users update` and `projects update` ask before a body with a `null`, which removes what it names, and take a new `--force`. `setup --dev-port` asks before removing the app's previous origin; without `--force` in a non-interactive run it keeps the old origin and warns.
