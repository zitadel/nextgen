---
"@zitadel/cli": minor
---

Every command now takes its whole invocation as one JSON document with `--input` (inline JSON, `@file.json` or `-` for stdin), also spelled `--flags-file` and `--cli-input-json`. The keys are the command's flag names, `args` holds the positionals, and only the global flags may stand beside it, so a document is never mixed with typed flags. It is done once, in a `prerun` hook (and an `init` hook for `--help` and `--version`), so no command knows about it, and every flag is still checked by its own declaration.
