---
"@zitadel/cli": patch
---

Every command the CLI suggests running next (`next_commands`, the `Next:` lines, the retry a refusal names) now carries the `--cwd`, `--env`, `--env-file` and `--server` the run was given, and a retry or a dry run's real command keeps every flag the run was typed with except the ones that only say how it answers (`--json`, `--non-interactive`, `--no-color`, `--verbose`, `--debug`, `--no-telemetry`). Suggestions name flags by their long form (`deploy --message '<what changed>'`, not `-m`), and a placeholder value is quoted so a shell does not read it as a redirection (`--client-id '<client-id>'`).
