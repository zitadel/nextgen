---
"@zitadel/api": minor
"@zitadel/server": minor
---

A release bundle's `oauth: { "enabled": true }` now takes effect: the server stores it as an OAuth settings revision, `GET /oauth_settings/{oauth_settings_id}` reads that revision back instead of answering 501, and every new revision is recorded as an `oauth_settings.created` event. On a server started with `oauth.enabled`, each primary origin the release is deployed to serves the project's RFC 8414 metadata at `/.well-known/oauth-authorization-server/oauth/<project_id>`. The console's release detail lists the pinned OAuth settings.
