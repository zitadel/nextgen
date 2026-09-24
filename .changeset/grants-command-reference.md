---
"@zitadel/cli": patch
---

Correct the published `grants` command reference. The README still documented `--principal-type` and `--principal-id` on `grants create`, and `principal_type` / `principal_id` as filter fields on `grants list`, which the user and team locators replaced: `grants create` takes `--relation` as its only required field flag and names the principal through `--data` / `--file`, and `grants list` filters on `user_id` and `team_id`.
