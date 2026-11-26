---
title: The CLI takes --dry-run and --server only where they apply
summary: A command takes --dry-run only when it changes something, and --server only when it reads a server, and every dry run says what it would do the same way. Scripts that pass either flag elsewhere need a change.
date: 2026-11-24T10:03Z
pulls: [3267]
---

A command takes `--dry-run` only when it changes something, and `--server` only when it reads a server. A dry run says `Would <verb> <subject> (dry run)`, and its `--json` `data` carries `verb`, `topic` and `id`. The commands that a command suggests next no longer carry `--server`, and the cross-flag errors of `logs`, `start` and `doctor` use oclif's wording.

**Breaking:** a command that only reads, such as `variable get`, `deployment list` or `status`, refuses `--dry-run` as an unknown flag. `start`, `stop`, `reset`, `logs`, `tests add`, `skills add`, `upgrade`, `eject` and `branding eject` never used `--server` and now refuse it. Remove those flags from your scripts. `deploy`, `release create`, `preview` and `env add` headline their dry runs differently, so match on `data.verb` rather than on the headline text.

[CLI reference](https://preview.zitadel.com/docs/reference/cli)
