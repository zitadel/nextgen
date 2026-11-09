---
"@zitadel/api": minor
"@zitadel/server": minor
---

A release bundle can now carry a project's OAuth settings as `oauth: { "enabled": true }`, and `GET /oauth_settings/{oauth_settings_id}` reads a published revision back ([docs](https://preview.zitadel.com/docs/reference/api/oauth-settings/getOAuthSettingsById)). The new scopes are `oauth_settings.read` and `oauth_settings.write`. The server does not store the settings yet: a bundle that carries `oauth` is refused with `rel.invalid` until it does.
