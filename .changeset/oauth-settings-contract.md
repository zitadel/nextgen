---
"@zitadel/api": minor
"@zitadel/server": minor
---

A release bundle accepts `oauth: { "enabled": true }`, which turns on the project's OAuth 2.0 authorization server once the release is deployed to a server started with `oauth.enabled`: each primary origin then serves its RFC 8414 metadata at `/.well-known/oauth-authorization-server/oauth/<project_id>`, and `GET /oauth_settings/{oauth_settings_id}` reads the pinned revision back ([docs](https://preview.zitadel.com/docs/reference/api/oauth-settings/getOAuthSettingsById)). Every new revision is recorded as an `oauth_settings.created` event.
