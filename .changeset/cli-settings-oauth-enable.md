---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel settings oauth enable` turns the project's OAuth authorization server on: it writes `.zitadel/oauth/oauth.json`, the one settings file beside the branding descriptor, and `zitadel deploy` ships it as the release's `oauth` resource. A release without the file leaves the authorization server off. `@zitadel/config` exports the file's `oauthConfigSchema`, its `oauth-settings.json` meta-schema and `OAUTH_FILE_SCHEMA_REF`.
