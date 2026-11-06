---
"@zitadel/server": minor
"@zitadel/cli": patch
---

`zitadel deployment rollback` and the console now warn before a rollback stops serving an origin ([Roll back a deploy](https://preview.zitadel.com/docs/guides/deploy#roll-back-a-deploy)).

**Breaking:** a rollback deploys to the origins of the deployment it goes back to, not to the project's current primary origins. An origin added since then refuses sign-in until the next `zitadel deploy`. `--json` lists those origins in `data.dropped_origins`, and origins the project no longer lists in `data.unserved_origins`.
