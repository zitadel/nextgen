---
"@zitadel/cli": minor
---

`zitadel invitation create` and `zitadel invitation cancel` report an anonymous `invitation_created` or `invitation_cancelled` event once the server confirms, carrying the role and a random journey ID, never a name, an invitation ID or the link. `invitation cancel` now names the invitation in its question and refuses one that is no longer pending before asking.
