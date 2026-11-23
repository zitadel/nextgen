---
"@zitadel/cli": minor
"@zitadel/config": patch
---

`zitadel api` now reads its JSON body from `--file <path>` (or `--file -` for stdin) instead of `--input`, matching the body flag on the generic create and update commands and freeing `--input` for passing a whole invocation as JSON. Breaking: `api --input <path>` is now `api --file <path>`. The flows README that ships into customer projects names the new flag.
