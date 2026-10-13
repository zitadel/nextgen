---
"@zitadel/cli": minor
"@zitadel/config": minor
---

`zitadel plan` and `zitadel apply` now check the SSO configuration across files before anything is sent. A flow step that offers a provider its user schema does not list, or when SSO is off; a schema that lists a provider with no connection file; a step that offers providers but does not route every outcome; a claim mapping that fills nothing the schema defines; and a mapping or `verified_claims` key that names a property no schema has, or a `verified_claims` key with no mapping, now stop with one error that names the file, the steps and the name at fault, and what to change. A connection that cannot create users needs only `sso_authenticated` routed and no claim mapping. `@zitadel/config/validate` exports `validateSsoConfiguration`, and the rules ship with a failing and a passing fixture each so the server can replay them.
