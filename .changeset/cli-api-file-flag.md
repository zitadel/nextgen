---
"@zitadel/cli": minor
"@zitadel/config": patch
---

`zitadel api` reads its JSON body from `--file <path>` (or `--file -` for stdin), matching the body flag on the create and update commands and freeing `--input` for a whole invocation as JSON. The flows README that ships into customer projects names the new flag.

**Breaking:** `api --input <path>` is now `api --file <path>`.
