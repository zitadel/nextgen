---
"@zitadel/api": minor
"@zitadel/server": minor
---

The API contract declares a project's OAuth settings: a release bundle accepts `oauth: { "enabled": true }`, a release pointer can be of `kind: oauth`, and `GET /oauth_settings/{oauth_settings_id}` is declared with the scopes `oauth_settings.read` and `oauth_settings.write` ([docs](https://preview.zitadel.com/docs/reference/api/oauth-settings/getOAuthSettingsById)). The server does not store the settings yet: it refuses a bundle that carries `oauth` with `rel.invalid`, and the read operation answers `not_implemented`, until it does.
