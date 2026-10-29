---
"@zitadel/cli": minor
---

`zitadel setup` deploys `.zitadel/` once it has committed the project, so the sign-in it asks you to verify is served a release. `data.deployment` reports what it deployed, and a failed deploy is a warning whose `next_commands` lead with the `deploy` that fixes it. `zitadel deploy`, `deployment create`, `env add`'s initial deploy and setup's deploy land on every primary origin and on the `default` target, which callers with no `Origin` are served. `deployment rollback` guards against the newest deployment to the targets it writes, so a newer deployment to `default` alone no longer makes it fail with a conflict.
