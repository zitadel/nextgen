---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
"@zitadel/config": minor
---

Flow definitions no longer take a `status`: every flow a release pins is served, and the release alone decides which flows are live.

**Breaking:** a flow definition that still sends `status` is refused. Delete the `"status"` line from each file in `.zitadel/flows/` before the next `zitadel deploy`. A `draft` flow is served as soon as a release pins it, including a release deployed before the upgrade, so move a draft out of `.zitadel/flows/` and deploy before upgrading if it should stay off.
