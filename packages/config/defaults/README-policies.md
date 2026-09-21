# Policies

This directory owns the operation policies of your project: one JSON file per
guarded operation, such as `user.password.save.json` for the rules that apply
whenever a password is set.

## Workflow

1. Edit the `config` values in the policy file. The editor validates them
   against `../meta/policy.json`; the platform validates them against the
   operation's template (bounds, fixed settings) on publish.
2. `zitadel plan` — shows the pending revision and warns when a value is
   legal but discouraged, such as a minimum password length below 15.
3. `zitadel apply` — publishes an immutable policy revision. The newest
   revision per operation is the one the platform evaluates.

Every edit publishes a new revision; there is no in-place update. Roll back
by re-applying an earlier file.

## What you can and cannot change

- `config` carries only the settings the operation exposes, within Zitadel's
  bounds. For `user.password.save`: `min_length` (8 to 64, default 15) and
  `history_depth` (0 to 4, default 0). The maximum length (64) and the
  built-in checks are fixed and cannot be turned off.
- `enforcement: "audit"` rolls out a stricter policy without blocking anyone:
  the defaults stay enforced, and only what you tightened beyond them is
  recorded instead of rejected. Switch back to `enforce` (the default) once
  the audit trail looks right.
- A stricter policy applies the next time a password is set. Existing
  passwords and sessions are not affected.

```json
{
  "$schema": "../meta/policy.json",
  "kind": "policy",
  "operation": "user.password.save",
  "config": {
    "min_length": 15,
    "history_depth": 0
  }
}
```
