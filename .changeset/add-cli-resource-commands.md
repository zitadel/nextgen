---
"@zitadel/cli": minor
---

Add resource commands to the CLI. `users`, `teams`, `sessions`, `events`, `grants`, and `projects` each gain the operations their API supports — users and teams the full set, sessions list, get and revoke, grants list, get, create and delete, projects list, get and update, and events list and get — with cursor pagination, `--filter` / `--sort`, per-field flags on writes, `--fields` to choose columns, local schema validation, `--dry-run`, and a `--force` guard on destructive verbs. `zitadel resources` reports the whole surface in one call.
