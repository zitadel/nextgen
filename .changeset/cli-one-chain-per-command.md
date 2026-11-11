---
"@zitadel/cli": minor
---

Only `zitadel setup` draws a chain and ends on a boxed summary. Every other command prints its answer at the left margin with one dim footer line saying what it amounts to and where it ran, asks its questions without the gutter, and offers a yes or no as a short list. What a command says while it works now comes from one logger.

**Breaking:** what every command prints for a person changed, and so did what a pipe reads from `deploy`, `pull`, `status`, `env` and the lists. `--json` keeps the shape of its envelope, but some `message`, `hint`, `next_actions` and `title` strings were reworded, and a hint that names a command now spells it out as `npx @zitadel/cli@<version> …`.
