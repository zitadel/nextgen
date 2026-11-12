---
"@zitadel/server": minor
---

The server gains an `oauth.enabled` setting (`NEXTGEN_OAUTH_ENABLED`, off by default) that serves the OAuth 2.0 authorization server: a project's RFC 8414 metadata at `/.well-known/oauth-authorization-server/oauth/<project_id>` and its endpoints under `/oauth/<project_id>`. A project's issuer answers only once the release deployed to that origin enables OAuth; every other issuer answers 404.
