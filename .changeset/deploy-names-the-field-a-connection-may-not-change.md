---
"@zitadel/cli": patch
---

When `zitadel deploy` is refused over a connection, the line now names the field it may not change, such as `oidc.issuer`, or the endpoints it left out.
