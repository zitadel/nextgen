---
"@zitadel/cli": patch
"@zitadel/config": patch
"@zitadel/server": patch
---

`zitadel deploy` now prints which schema, flow or connection the server rejected and why, instead of only `release: invalid`; a connection's line names the field it may not change, such as `oidc.issuer`, or the endpoints it left out. A schema that fails the meta-schema names the failing property path and keyword. The `warn/password-without-identifier` warning no longer fires for a password step reached through an SSO email collision, so the scaffolded flow deploys without a false `sso-conflict` warning.
