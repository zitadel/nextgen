---
"@zitadel/cli": patch
---

The agent skill bundled with the CLI now says consistently that `zitadel setup`
deploys `.zitadel/` after it scaffolds the project, so an agent no longer runs
an extra `deploy` or tells you nothing was published.
