---
"@zitadel/cli": minor
---

A command now takes `--dry-run` only when it changes something. A dry run says `Would <verb> <subject> (dry run)`, and its `--json` `data` carries `verb`, `topic` and `id`. The cross-flag errors of `logs`, `start` and `doctor` use oclif's wording.

**Breaking:** a command that only reads, such as `variable get`, `deployment list` or `status`, now refuses `--dry-run` as an unknown flag, and `deploy`, `release create`, `preview` and `env add` headline their dry runs differently. Stop passing `--dry-run` to reads, and match on `data.verb` rather than on the headline text.
