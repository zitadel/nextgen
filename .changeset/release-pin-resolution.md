---
"@zitadel/server": minor
---

A flow started with `X-Zitadel-Release` runs on the release the app was built against, as long as that release was deployed to the app's origin and is not revoked, so an app and its sign-in configuration roll out and roll back together. A pin to a release never deployed to the origin, or sent without an `Origin`, answers `409 rel.not_deployed`; a revoked release `409 rel.revoked`; an unknown id `404 rel.not_found`.
