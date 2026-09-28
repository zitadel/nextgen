---
"@zitadel/cli": patch
---

Correct the `grants` command reference. The README still documented `--principal-type` and `--principal-id` on `grants create`, and `principal_type` / `principal_id` as filter fields on `grants list`, which the user and team locators replaced: `grants create` takes `--relation` as its only required field flag and names the principal through `--data` / `--file`, and `grants list` filters on `user_id` and `team_id`.

`grants create --help` also no longer suggests `grants create --relation viewer`. A grant needs exactly one of `user` or `team`, which are nested objects no flag can carry, so that run was never a complete body. Any write command whose body needs a nested object or an array now offers only its `--data` and `--file` examples.
