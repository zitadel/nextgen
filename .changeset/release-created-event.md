---
"@zitadel/server": minor
"@zitadel/api": minor
---

The events API defines the `release.created` event type and its payload.

The payload carries the release's `content_hash`, its audit metadata (`message`, `git_sha`, `git_dirty`) and the `(kind, handle, revision_id)` tuples the release pins, so an audit stream answers what a release changed without reading the releases table. Nothing emits the event until `POST /releases` is implemented.
