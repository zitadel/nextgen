---
"@zitadel/server": patch
"@zitadel/api": patch
---

Creating a session for another project's user now returns 403 instead of a server error, a schema URL the server cannot fetch returns a 400, and a deployment can be created from a release's `content_hash`, which used to return 501.
