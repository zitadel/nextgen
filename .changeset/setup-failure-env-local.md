---
"@zitadel/cli": patch
---

`zitadel setup` now puts `.env.local` back the way it was before the run when it fails after creating the project, for example because the default user schema or login flow did not upload. Before, the file kept the failed run's project id and secret, and since setup only adds the keys `.env.local` is missing, even with `--force`, the app set up by a rerun still talked to that abandoned project, which has no user schema or login flow.
