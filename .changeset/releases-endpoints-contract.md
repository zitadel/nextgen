---
"@zitadel/server": minor
---

The API contract gains **releases** — immutable, project-scoped configuration snapshots. A release pins one revision of each resource it includes and records who assembled it, from what commit, and why; it carries pointers and metadata, never resource content.

Three endpoints are described: `POST /releases` bundles a release from revision ids that already exist, `GET /releases` lists a project's releases newest first with the pinned set omitted, and `GET /releases/{release_id}` reads one release with its pointers.

`POST /releases` is idempotent on the pinned set — metadata is excluded from the comparison, so re-submitting the same revisions with a different message answers `200` with the release that already pins them instead of `201` and a duplicate.

This ships the contract and the generated clients only. The endpoints answer `501` until the implementation lands.
