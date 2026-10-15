---
"@zitadel/cli": minor
---

Replace the `variables` command group with a project-scoped `variable` group: `variable set`, `variable get`, `variable list`, `variable rm`, and a new `variable resolve`. A variable belongs to the project, so the commands no longer take `--project-level`. `variable set NAME VALUE` now accepts a plain value on the command line; a secret still refuses a value there and is prompted for or piped in.

A variable holds a value per kind: the primary one, which primary deployments freeze, and a preview one, which preview deployments freeze. Neither falls back to the other. `variable set` stores a plain value for both kinds, and a secret for the primary kind only, replacing any preview value so a preview never keeps a plaintext copy. Pass `--preview` to work with the preview kind alone: `variable set --preview` writes only it, `variable get` and `variable list` read it, and `variable rm --preview` removes it and leaves the primary value. Without `--preview`, `get` and `list` read the primary values and `rm` removes both kinds. A plain `--preview` value for a name whose primary value is a secret is refused, with the `--secret` form to use instead.

`variable resolve` shows the variables a target actually runs — the map frozen onto its live deployment — with `--origin` to pick a target. The server does not store frozen sets yet, so it answers `not_implemented` until it does.

**Breaking:** the `variables` commands and the `--project-level` flag are removed. Drop `--project-level`, and use `variable set NAME`, `variable get NAME`, `variable list`, `variable rm NAME` in place of the old `variables set`/`get`/`list`/`delete`.
