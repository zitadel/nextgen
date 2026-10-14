---
"@zitadel/server": minor
---

`POST /releases` accepts `idp` pointers and validates a release's revisions against each other. A handle the release does not reference answers `400 rel.unresolved_reference` naming the resource and the handle: a flow definition's `user_schema`, a flow step's `sso_providers`, or a schema's `x-auth-methods.sso.providers`. A flow that does not fit the user schema revision the release references answers `400 rel.invalid` naming the flow and the revision.
