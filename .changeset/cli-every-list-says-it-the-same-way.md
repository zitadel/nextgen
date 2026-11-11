---
"@zitadel/cli": patch
"@zitadel/config": patch
---

`zitadel variable list`, `origin list`, `env list` and `resources` answer an empty result with `No <things> found.`, like every other list. A blank display name, client id or client secret is reported as empty rather than as an instruction to type one; it reaches `--json` only as an error `message`.
