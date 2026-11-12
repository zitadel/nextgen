---
"@zitadel/cli": minor
---

Only `zitadel setup` draws a chain and a boxed summary; every other command prints its answer at the left margin with one dim footer line saying where it ran, and asks its questions without the gutter.

**Breaking:** what every command prints for a person changed, and so did what a pipe reads from `deploy`, `pull`, `status`, `env` and the lists. `--json` keeps the shape of its envelope, but some `message`, `hint`, `next_actions` and `title` strings were reworded, and a hint that names a command now spells it out as `npx @zitadel/cli@<version> …`.
