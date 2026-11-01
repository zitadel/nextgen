---
"@zitadel/cli": minor
---

`zitadel setup` deploys `.zitadel/` to the app's origin once it has committed the project, so the sign-in it asks you to verify is served the release it built. `data.deployment` reports what it deployed, and a failed deploy is a warning whose `next_commands` lead with the `deploy` that fixes it.
