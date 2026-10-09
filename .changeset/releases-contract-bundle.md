---
"@zitadel/server": minor
---

`POST /releases` accepts a `bundle` of the resources as authored on disk as an alternative to `pointers`. The server reuses the project's newest revision of each resource when the content matches and allocates a new one otherwise, and answers the release that pins them.
