---
"@zitadel/server": minor
"@zitadel/api": minor
---

Releases can now be read back over the API.

`GET /releases` lists a project's releases newest first, carrying metadata only — the pinned set is omitted. `GET /releases/{release_id}` returns one release with the revisions it pins.
