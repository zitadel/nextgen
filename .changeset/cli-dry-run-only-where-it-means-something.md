---
"@zitadel/cli": minor
---

`--dry-run` is now taken only by a command that changes something, and `--force` only by one that asks for consent. A command that merely reads, such as `variable get` or `deployment list`, now refuses either flag as unknown instead of accepting it and ignoring it, so a script that passes `--dry-run` to every command needs to stop doing that for reads. `auth-method <method> enable` likewise no longer takes `--force`, which it never used. A dry run now says `Would <verb> <subject> (dry run)` and its `data` carries `verb`, `topic` and `id`, so `deploy`, `release create`, `preview` and `env add` headlines changed. Results carry the same `title` in `data` and in the summary. The cross-flag errors of `server logs`, `server start` and `doctor --force` without `--fix` now use oclif's wording.
