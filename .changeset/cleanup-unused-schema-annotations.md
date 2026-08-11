---
"@zitadel/cli": patch
"@zitadel/config": patch
"@zitadel/server": patch
"@zitadel/server-linux-x64": patch
"@zitadel/server-linux-arm64": patch
"@zitadel/server-darwin-x64": patch
"@zitadel/server-darwin-arm64": patch
"@zitadel/server-win32-x64": patch
---

Trim the user-schema dialect to the keywords that are actually read.

- Drop the `x-verify`, `x-claim` and `x-mfa` user-property annotations. No code
  path reads any of them: verification method, OIDC claim mapping and OTP
  delivery are all unimplemented, and the backend maps identity by attribute
  name. Removed from the `user-property` meta-schema (and its committed copy
  under `.zitadel/meta/`), the scaffolded defaults and the flow-engine design
  docs. `x-mfa` also leaves the CLI's schema normalizer default table, so a
  property spelling it out is no longer stripped before diffing.
- Drop `position` from `x-auth-methods` entries. `enabled` stays and is now the
  only required key. The order sign-in methods are offered in comes from the
  order of a step's actions in the flow definition, so a second ordering knob on
  the schema could only disagree with it. The console's schema list orders its
  sign-in chip by the meta-schema's own method enumeration instead.

`UserProperty` keeps `additionalProperties: true`, so an existing schema that
still carries one of these keywords is accepted — it is simply no longer part of
the dialect.
