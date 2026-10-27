---
"@zitadel/cli": minor
---

Variables now belong to the project, under a new `variable` group, and hold a primary value, which primary deployments freeze, and a preview value, which previews freeze, with no fallback between them ([docs](https://preview.zitadel.com/docs/reference/cli/variable/set)). A plain `variable set` writes both, a secret only the primary, and `--preview` works with the preview value alone; `variable resolve` shows what a live deployment runs.

**Breaking:** the `variables` commands and the `--project-level` flag are removed. Drop `--project-level`, and use `variable set NAME`, `variable get NAME`, `variable list`, `variable rm NAME` in place of the old `variables set`/`get`/`list`/`delete`.
