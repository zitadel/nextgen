---
"@zitadel/server": minor
---

Build a release from a `.zitadel/` configuration bundle in one request (`POST /releases/build`): unchanged resources reuse their newest revision, changed ones allocate, and the release is created or returned when the content hash already exists.
