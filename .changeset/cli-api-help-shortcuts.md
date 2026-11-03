---
"@zitadel/cli": patch
---

`zitadel api -h` and `zitadel api help` now show the command's help, as `zitadel api --help` does, instead of failing with `No operation is called help`. `-h` works as `--help` on every command.
