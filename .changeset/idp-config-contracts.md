---
"@zitadel/config": minor
"@zitadel/cli": minor
"@zitadel/server": minor
---

Social login gets its configuration contracts. `zitadel setup` now copies two more dialect files into `.zitadel/meta/`: `idp-connection.json`, the schema for a provider connection file, and `sso-auth-method.json`, the shape of the `sso` slot in a user schema. A user schema with `sso.enabled: true` must now list the connection slugs its users may sign in with under `sso.providers`, and a disabled slot must not carry the list. In a flow definition, `sso_providers` is a list of connection slugs instead of `{id, name, template}` objects, `on_success` accepts `create_user_with_sso`, and `identity_unknown` is a reserved transition outcome that switches a login flow to register when a provider returns an unknown user.
