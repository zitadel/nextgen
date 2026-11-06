---
"@zitadel/cli": patch
---

`zitadel deploy` from an uncommitted tree now says its release records an approximate commit and suggests the commit as the next step, and the CLI skill tells agents to commit `.zitadel/` before every deploy, not to deploy changes they cannot account for, and that a project has no OAuth client, only a project id and secret.
