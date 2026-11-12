---
"@zitadel/server": minor
---

The server gains an `oauth.enabled` setting (`NEXTGEN_OAUTH_ENABLED`, off by default) that serves the OAuth 2.0 authorization server: a project's RFC 8414 metadata at `/.well-known/oauth-authorization-server/oauth/<project_id>` and its endpoints under `/oauth/<project_id>`. A project's issuer answers only once the project has OAuth enabled, which a later release adds, so every issuer answers 404 for now.
