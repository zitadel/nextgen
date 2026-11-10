---
"@zitadel/server": minor
"@zitadel/api": minor
"@zitadel/cli": minor
"@zitadel/config": minor
---

Flow definitions no longer take a `status`: every flow a release pins is served, and the release alone decides which flows are live.

**Breaking:** a flow definition that still sends `status` is refused. Delete the `"status"` line from each file in `.zitadel/flows/` before the next `zitadel deploy`; a flow you kept as a `draft` is served once a release pins it, so move it out of `.zitadel/flows/` if it should stay off.
