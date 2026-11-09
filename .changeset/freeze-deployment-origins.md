---
"@zitadel/server": minor
"@zitadel/cli": patch
---

`zitadel deployment rollback` and the console now name the origins a rollback stops or starts serving ([Roll back a deploy](https://preview.zitadel.com/docs/guides/deploy#roll-back-a-deploy)).

**Breaking:** a rollback deploys to the origins of the deployment it goes back to, not to the project's current primary origins. An origin added since then refuses sign-in until the next `zitadel deploy`, and an origin that deployment named serves its release again. `--json` lists them in `data.dropped_origins` and `data.restored_origins`, and origins the project no longer lists in `data.unserved_origins`.
