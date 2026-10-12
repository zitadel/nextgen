---
"@zitadel/server": minor
---

The API contract gains `POST /releases/build`, which builds a release from the resources as authored on disk, allocating revisions where the content changed. `POST /releases` keeps pinning existing revisions. The server does not build releases yet and answers `POST /releases/build` with `501`.
