---
"@zitadel/server": minor
---

The releases API contract gains three things. `POST /releases` accepts a `bundle` of the resources as authored on disk as an alternative to `pointers`, and answers the release together with the revision it pinned per resource and whether that revision was allocated by the call. Every release carries `content_hash`, its `sha256:`-prefixed content digest, which `GET /releases` can filter on. `POST /releases/{release_id}/revoke` marks a release revoked, recorded in `revoked_at` and emitted as `release.revoked`.
