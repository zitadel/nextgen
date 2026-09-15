---
"@zitadel/config": minor
"@zitadel/cli": minor
"@zitadel/server": minor
---

Social login gets its configuration contracts. `zitadel setup` now copies two more dialect files into `.zitadel/meta/`: `idp-connection.json`, the schema for a provider connection file, and `sso-auth-method.json`, the shape of the `sso` slot in a user schema. A user schema with `sso.enabled: true` must now list the connection slugs its users may sign in with under `sso.providers`, and a disabled slot must not carry the list. In a flow definition, `identity_unknown` is a reserved transition outcome that switches a login flow to register when a provider returns an unknown user. The editor schema also describes `sso_providers` as a list of connection slugs and `on_success: create_user_with_sso`; the CLI and the API accept those shapes once the rendering and collection-step work lands.
