---
title: A rollback serves the origins it goes back to
summary: zitadel deployment rollback now deploys to the origins of the deployment it restores, and it and the console name the origins a rollback stops or starts serving. This is a breaking change.
date: 2026-11-09T10:53Z
cloud: true
pulls: [2556]
---

`zitadel deployment rollback` and the console now name the origins a rollback stops or starts serving. With `--json`, `data.dropped_origins`, `data.restored_origins` and `data.unserved_origins` list them.

**Breaking:** a rollback deploys to the origins of the deployment it goes back to, not to the project's current primary origins. An origin added since then refuses sign-in until the next `zitadel deploy`, and an origin that deployment named serves its release again.

[Roll back a deploy](https://preview.zitadel.com/docs/guides/deploy#roll-back-a-deploy)
