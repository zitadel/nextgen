---
"@zitadel/server": minor
"@zitadel/api": minor
---

Releases can now be created over the API.

`POST /releases` bundles a release from revisions that already exist, supplied as `(kind, revision_id)` pairs; the handle each revision declares is read from the revision itself and recorded on the release. Submitting a set that a release already pins returns that release with `200` instead of creating a second one, so re-running a deploy on unchanged configuration is a no-op.

Every release is recorded in the audit stream as `release.created`, carrying what it pinned.
