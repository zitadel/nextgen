---
"@zitadel/cli": minor
---

Every command now takes its whole invocation as one JSON document with `--input` (inline JSON, `@file.json` or `-` for stdin), also spelled `--flags-file` and `--cli-input-json`: the keys are the command's flag names, `args` holds the positionals, and only the global flags may stand beside it. A document cannot set `server`, `env`, `env-file` or `cwd`, so one read from elsewhere cannot point the run's credentials at another server or project; a document that is not JSON is refused without quoting its text, and a file that is not a regular file of at most 8 MB is refused.
