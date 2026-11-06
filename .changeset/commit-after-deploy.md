---
"@zitadel/cli": patch
---

`zitadel deploy` from an uncommitted tree now says the changes are not committed and suggests the `git commit` as the next step, and the CLI skill tells agents to commit right after every deploy and that a project has no OAuth client, only a project id and secret.
