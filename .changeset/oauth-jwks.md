---
"@zitadel/server": minor
---

With `oauth.enabled`, `/oauth/<project_id>/jwks`, the `jwks_uri` of a project's issuer, serves the public keys of the project's token signing keys as a JWK set, so a backend can verify the project's access tokens. The set does not depend on the project's release: a release that turns OAuth off leaves it up, so tokens issued before stay verifiable until they expire. A project that does not exist answers 404. A verifier may cache the set for `oauth.jwks_max_age`, 5 minutes by default.
