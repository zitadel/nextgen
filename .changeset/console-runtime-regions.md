---
"@zitadel/server": patch
---

The console's runtime document (`GET /console/runtime.json`) reports
`mode: "platform"` and lists the regions of the cloud (`regions`: id, name,
API base) when the server is configured as the identity home of one
(`platform.regions`). Without regions the document is unchanged.
