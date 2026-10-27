---
"@zitadel/cli": minor
---

`zitadel pull` rebuilds `.zitadel/` from what a release pins — the live release by default, a release id (`rel_…`) or a deployment id (`dep_…`) — so the next `deploy` builds the same release ([docs](https://preview.zitadel.com/docs/reference/cli/pull)). It restores schemas and flow definitions, and warns for branding and identity provider connections, which it cannot read back yet.
