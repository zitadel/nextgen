---
title: Every zitadel command reads the same way
summary: Commands print their answer at the left margin, every error ends with its code and says what to run next, resource commands are named in the singular, and the help groups commands by task. Scripts that read the CLI's text may need a change.
date: 2026-11-16T17:01Z
pulls: [2379, 3109, 3159, 3010, 3014]
---

Only `zitadel setup` still draws a chain and a boxed summary. Every other command prints its answer at the left margin, with one dim footer line saying where it ran. Every failure reads `Error: <sentence> (E_CODE)`, with the hint under it, the commands to run next under `Next:`, and the project and server it failed against. A confirmation names the project and server it acts on: `Remove FOO from project proj_1 on api.zitadel.cloud?`

- Resource commands are named in the singular, as `release`, `deployment` and `variable` already were: `zitadel user list`, `zitadel policy test`. The plural still runs, so `zitadel users list` keeps working; help, completion and the reference show the singular.
- `zitadel --help` groups the commands by task: Getting started, Local server, Users and access, Sign-in, Project settings, Releases, API and events, and CLI.
- A command that does not exist fails like any other: it names the close matches to type, and under `--json` prints one `E_VALIDATION` envelope. It no longer asks "Did you mean …?" and offers to run a different command with your flags dropped.
- Every command the CLI suggests next keeps the `--cwd`, `--env`, `--env-file` and `--server` you gave, spells flags out in full and quotes placeholders, so you can paste it.

**Breaking:** what commands print for a person changed, and so did what a pipe reads from `deploy`, `pull`, `status`, `env` and the lists. The error code moved to the end of the line: read `Error: … (E_…)` where you read `Error E_…:`. `--json` keeps the shape of its envelope and the exit codes, but some `message`, `hint`, `next_actions` and `title` strings were reworded, and `command` and `topic` name the singular (`user:list`, not `users:list`). A plural typed alone, such as `zitadel users`, now fails as an unknown command and points to `zitadel user --help`.

[CLI reference](https://preview.zitadel.com/docs/reference/cli)
