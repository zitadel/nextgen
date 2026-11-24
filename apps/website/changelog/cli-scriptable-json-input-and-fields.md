---
title: Script the CLI with one JSON document and --fields
summary: Every zitadel command takes its whole invocation as JSON with --input, every list and get takes --fields, which now cuts --json too, and JSON comes only with --json. Scripts that parsed the CLI's output may need a change.
date: 2026-11-24T02:09Z
pulls: [3245]
---

An agent or a script can now drive the CLI without building a command line or scraping its text. Every command takes its whole invocation as one JSON document with `--input`: inline, `@file.json`, or `-` for stdin. The keys are the command's flag names, and `args` holds the positionals. `--flags-file` and `--cli-input-json` are other names for it.

```sh
zitadel user list --fields id,email --json
```

- Every command that prints a list or a record takes `--fields`, and it cuts the records under `--json` as well as the table. A field the command does not carry is refused with the ones it does.
- A document passed with `--input` cannot set `server`, `env`, `env-file`, `project` or `cwd`, so one read from elsewhere cannot point your credentials at another server or project. Type those beside it.
- `version`, `commands`, `which`, `help` and `autocomplete` answer `--json` with the same envelope as every other command.
- Every list reports `truncated` beside `next_page_token`, `true` exactly when more remain.
- An update that sets a field to `null` removes it, so it now asks first, as a deletion does.
- A command line the CLI refuses, a flag typed twice included, is one coded failure that points to the command's help.
- An id of `.` or `..`, and a control character in an id or an `api` path value, is refused before a request is made.
- `FORCE_COLOR=0` and `FORCE_COLOR=false` turn colour off instead of forcing it on.

**Breaking:** pass `--json` wherever a script parses JSON: `get` commands and created or updated resources printed JSON when stdout was not a terminal, and now print the same plain text as on one. `zitadel api --input <path>` is now `zitadel api --file <path>`. A script that passed `--fields` with `--json` and read the whole record must stop passing `--fields`. An update with `:=null` needs `--force` when nothing can ask. `version --json` and `commands --json` print their result as the envelope's `data`, with the commands under `data.result`. A refused command line no longer carries `details.original`.

[Use the CLI from an agent](https://preview.zitadel.com/docs/get-started/agents), [CLI reference](https://preview.zitadel.com/docs/reference/cli)
