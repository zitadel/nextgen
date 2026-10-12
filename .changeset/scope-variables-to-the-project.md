---
"@zitadel/cli": minor
"@zitadel/server": minor
"@zitadel/api": minor
---

Replace the `variables` command group with a project-scoped `variable` group: `variable set`, `variable get`, `variable list`, `variable rm`, and a new `variable resolve`. A variable belongs to the project, so the commands no longer take `--project-level`. `variable set NAME VALUE` now accepts a plain value on the command line; a secret still refuses a value there and is prompted for or piped in.

Each variable can carry a preview value alongside its usual one. Pass `--preview` to `variable set`, `get`, `list` or `rm` to work with the override a preview deployment prefers; without it you work with the value every deployment freezes. `variable resolve` shows the variables a target actually runs — the map frozen onto its live deployment — with `--origin` to pick a target.

**Breaking:** the `variables` commands and the `--project-level` flag are removed. Drop `--project-level`, and use `variable set NAME`, `variable get NAME`, `variable list`, `variable rm NAME` in place of the old `variables set`/`get`/`list`/`delete`.

The project-scoped variable API surface ships with this change (`@zitadel/server`), along with the generated client operations the CLI drives it through (`@zitadel/api`): reading and patching a project's variables and reading the map a deployment froze, with the preview value carried as a separate `applies_to` slot.
